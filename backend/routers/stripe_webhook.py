"""
stripe_webhook.py

POST /stripe/webhook — Stripe event handler.

Security considerations:
- Every request is verified with stripe.Webhook.construct_event() using the
  STRIPE_WEBHOOK_SECRET. A request with an invalid or missing signature is
  rejected with 400 before any processing occurs. This prevents spoofed events.
- The raw request body must be read as bytes before Pydantic/FastAPI parses it,
  because Stripe's signature is computed over the exact byte sequence.
- Subscription status is always derived from Stripe event data, never from
  client-supplied JSON in API calls.
- stripe_customer_id and stripe_subscription_id are stored for reconciliation
  but are NOT used to look up users — user_id comes from Stripe metadata
  set at checkout creation time.
"""

import logging
import os

import stripe
from fastapi import APIRouter, HTTPException, Request

from db.supabase_client import get_client

logger = logging.getLogger(__name__)
router = APIRouter()


def _configure_stripe() -> None:
    key = os.environ.get("STRIPE_SECRET_KEY", "")
    if not key:
        raise RuntimeError("STRIPE_SECRET_KEY must be set in environment.")
    stripe.api_key = key


def _webhook_secret() -> str:
    secret = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
    if not secret:
        raise RuntimeError("STRIPE_WEBHOOK_SECRET must be set in environment.")
    return secret


@router.post("/stripe/webhook", status_code=200)
async def stripe_webhook(request: Request):
    payload = await request.body()  # raw bytes required for signature verification
    sig_header = request.headers.get("stripe-signature", "")

    try:
        _configure_stripe()
        event = stripe.Webhook.construct_event(payload, sig_header, _webhook_secret())
    except stripe.error.SignatureVerificationError as exc:
        logger.warning("Stripe webhook signature verification failed: %s", exc)
        raise HTTPException(status_code=400, detail="Invalid Stripe signature.")
    except Exception as exc:
        logger.error("Stripe webhook parse error: %s", exc)
        raise HTTPException(status_code=400, detail="Webhook parse error.")

    event_type = event["type"]
    data = event["data"]["object"]
    logger.info("Stripe event: %s", event_type)

    db = get_client()

    if event_type == "checkout.session.completed":
        user_id = data.get("metadata", {}).get("user_id")
        if not user_id:
            logger.warning("checkout.session.completed missing metadata.user_id — skipping")
            return {"received": True}

        customer_id = data.get("customer")
        subscription_id = data.get("subscription")
        plan = data.get("metadata", {}).get("plan", "creator")

        db.table("subscriptions").upsert({
            "user_id": user_id,
            "stripe_customer_id": customer_id,
            "stripe_subscription_id": subscription_id,
            "status": "active",
            "plan": plan,
        }, on_conflict="user_id").execute()
        logger.info("Subscription activated for user %s (plan=%s)", user_id, plan)

    elif event_type == "customer.subscription.updated":
        subscription_id = data.get("id")
        status = data.get("status")  # active | past_due | canceled | ...
        plan_id = data.get("items", {}).get("data", [{}])[0].get("price", {}).get("metadata", {}).get("plan", "creator")

        db.table("subscriptions").update({
            "status": "active" if status == "active" else status,
            "plan": plan_id,
        }).eq("stripe_subscription_id", subscription_id).execute()
        logger.info("Subscription %s updated: status=%s plan=%s", subscription_id, status, plan_id)

    elif event_type == "customer.subscription.deleted":
        subscription_id = data.get("id")
        db.table("subscriptions").update({
            "status": "cancelled",
        }).eq("stripe_subscription_id", subscription_id).execute()
        logger.info("Subscription %s cancelled", subscription_id)

    else:
        logger.debug("Unhandled Stripe event type: %s", event_type)

    return {"received": True}
