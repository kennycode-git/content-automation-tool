"""Release announcement preview, approval, and broadcast helpers."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import html
import logging
import os
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

import httpx

logger = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = Path(__file__).resolve().parents[1]
RELEASE_ROOTS = tuple(dict.fromkeys((REPO_ROOT / "releases", BACKEND_ROOT / "releases")))
TEMPLATE_PATH = Path(__file__).resolve().parents[1] / "templates" / "release_update_email.html"

RESEND_API_URL = "https://api.resend.com/emails"
DEFAULT_FROM = "no-reply@passiveclip.com"


@dataclass
class RenderedReleaseEmail:
    subject: str
    headline: str
    intro: str
    summary_text: str
    body_html: str
    html: str
    text: str


@dataclass
class Recipient:
    email: str
    user_id: str | None = None
    source: str = "auth"

    @property
    def unsubscribe_user_id(self) -> str:
        return self.user_id or "invite"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalise_markdown_path(markdown_path: str) -> Path:
    raw = markdown_path.replace("\\", "/").lstrip("/")
    if not raw.startswith("releases/"):
        raise ValueError("Release markdown must live inside the /releases directory.")

    relative = raw.removeprefix("releases/")
    if Path(relative).suffix.lower() != ".md":
        raise ValueError("Release markdown file must be a .md file.")

    looked_at: list[str] = []
    for releases_root in RELEASE_ROOTS:
        resolved = (releases_root / relative).resolve()
        root = releases_root.resolve()
        if root not in resolved.parents and resolved != root:
            raise ValueError("Release markdown must live inside the /releases directory.")
        looked_at.append(str(resolved))
        if resolved.exists():
            return resolved

    raise FileNotFoundError(
        f"Release markdown not found: {markdown_path}. Looked at: {', '.join(looked_at)}"
    )


def read_release_markdown(markdown_path: str) -> str:
    path = _normalise_markdown_path(markdown_path)
    return path.read_text(encoding="utf-8")


def _strip_md(text: str) -> str:
    text = re.sub(r"`([^`]+)`", r"\1", text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"\1", text)
    text = re.sub(r"\*([^*]+)\*", r"\1", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    return text.strip()


def _inline_markdown_html(text: str) -> str:
    escaped = html.escape(text.strip())
    escaped = re.sub(
        r"\[([^\]]+)\]\((https?://[^)]+)\)",
        lambda m: f'<a href="{html.escape(m.group(2), quote=True)}" style="color:#a16207;text-decoration:underline;">{m.group(1)}</a>',
        escaped,
    )
    escaped = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", escaped)
    escaped = re.sub(r"\*([^*]+)\*", r"<em>\1</em>", escaped)
    return escaped


def markdown_to_email_body_html(markdown: str) -> str:
    """Render the release markdown into email-safe HTML without external parser dependencies."""
    lines = markdown.splitlines()
    parts: list[str] = []
    list_type: str | None = None

    def close_list() -> None:
        nonlocal list_type
        if list_type:
            parts.append(f"</{list_type}>")
            list_type = None

    def open_list(tag: str) -> None:
        nonlocal list_type
        if list_type == tag:
            return
        close_list()
        style = "margin:0 0 18px;padding:0 0 0 22px;color:#332d26;font-size:15px;line-height:1.65;"
        parts.append(f'<{tag} style="{style}">')
        list_type = tag

    for raw_line in lines:
        line = raw_line.strip()
        if not line:
            close_list()
            continue
        if line.startswith("# "):
            continue
        if line.startswith("## "):
            close_list()
            parts.append(
                f'<h2 style="margin:28px 0 12px;color:#171512;font-size:21px;line-height:1.25;font-weight:800;">{_inline_markdown_html(line[3:])}</h2>'
            )
            continue
        if line.startswith("### "):
            close_list()
            parts.append(
                f'<h3 style="margin:24px 0 10px;color:#171512;font-size:17px;line-height:1.35;font-weight:800;">{_inline_markdown_html(line[4:])}</h3>'
            )
            continue
        if line.startswith(("- ", "* ")):
            open_list("ul")
            parts.append(f'<li style="margin:0 0 10px;">{_inline_markdown_html(line[2:])}</li>')
            continue
        ordered = re.match(r"^\d+\.\s+(.+)$", line)
        if ordered:
            open_list("ol")
            parts.append(f'<li style="margin:0 0 10px;">{_inline_markdown_html(ordered.group(1))}</li>')
            continue

        close_list()
        parts.append(
            f'<p style="margin:0 0 16px;color:#332d26;font-size:15px;line-height:1.75;">{_inline_markdown_html(line)}</p>'
        )

    close_list()
    return "\n".join(parts)


def markdown_to_email_points(markdown: str, max_items: int = 6) -> list[str]:
    points: list[str] = []
    for line in markdown.splitlines():
        stripped = line.strip()
        if stripped.startswith(("- ", "* ")):
            point = _strip_md(stripped[2:])
            if point:
                points.append(point)
        if len(points) >= max_items:
            break
    if points:
        return points

    fallback = [_strip_md(line.lstrip("#").strip()) for line in markdown.splitlines() if line.strip()]
    return [line for line in fallback if line][:max_items]


def markdown_title(markdown: str, version: str, fallback_title: str | None = None) -> str:
    for line in markdown.splitlines():
        stripped = line.strip()
        if stripped.startswith("# "):
            return _strip_md(stripped.lstrip("#").strip())
    return fallback_title or "Passive Clip"


async def maybe_summarise_with_llm(markdown: str, version: str, title: str) -> list[str] | None:
    """Optional OpenAI-compatible summarisation hook, disabled unless env is configured."""
    if os.environ.get("RELEASE_EMAIL_USE_LLM", "").lower() != "true":
        return None
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        logger.warning("RELEASE_EMAIL_USE_LLM=true but OPENAI_API_KEY is not configured.")
        return None

    model = os.environ.get("RELEASE_EMAIL_LLM_MODEL", "gpt-4o-mini")
    prompt = (
        "Turn this release markdown into 4-6 short product-update bullets for a customer email. "
        "Keep it plain, friendly, specific, and avoid hype. Return one bullet per line, no markdown headings.\n\n"
        f"Version: {version}\nTitle: {title}\n\n{markdown[:6000]}"
    )
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": "You write concise SaaS product-update emails."},
                        {"role": "user", "content": prompt},
                    ],
                    "temperature": 0.3,
                },
            )
        if not response.is_success:
            logger.warning("Release LLM summary failed: %s", response.text[:500])
            return None
        content = response.json()["choices"][0]["message"]["content"]
        return [
            _strip_md(line.strip().lstrip("-*").strip())
            for line in content.splitlines()
            if line.strip().lstrip("-*").strip()
        ][:6]
    except Exception as exc:
        logger.warning("Release LLM summary failed: %s", exc)
        return None


def _summary_html(points: list[str]) -> str:
    items = "\n".join(
        f'<li style="margin:0 0 12px;color:#332d26;font-size:15px;line-height:1.65;">{html.escape(point)}</li>'
        for point in points
    )
    return f'<ul style="margin:0;padding:0 0 0 20px;">{items}</ul>'


def _render_template(template: str, context: dict[str, str]) -> str:
    rendered = template
    for key, value in context.items():
        rendered = rendered.replace("{{ " + key + " }}", value)
        rendered = rendered.replace("{{" + key + "}}", value)
    return rendered


def build_unsubscribe_token(user_id: str, email: str) -> str:
    secret = os.environ.get("RELEASE_EMAIL_SECRET") or os.environ.get("ADMIN_SECRET_KEY") or ""
    if not secret:
        raise RuntimeError("RELEASE_EMAIL_SECRET or ADMIN_SECRET_KEY must be configured for unsubscribe links.")
    payload = f"{user_id}:{email.lower()}"
    sig = hmac.new(secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    encoded = base64.urlsafe_b64encode(payload.encode("utf-8")).decode("ascii").rstrip("=")
    return f"{encoded}.{sig}"


def parse_unsubscribe_token(token: str) -> tuple[str, str]:
    try:
        encoded, sig = token.split(".", 1)
        padded = encoded + "=" * (-len(encoded) % 4)
        payload = base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8")
        user_id, email = payload.split(":", 1)
    except Exception as exc:
        raise ValueError("Invalid unsubscribe token.") from exc
    expected = build_unsubscribe_token(user_id, email).split(".", 1)[1]
    if not hmac.compare_digest(sig, expected):
        raise ValueError("Invalid unsubscribe token.")
    return user_id, email


def release_api_public_url() -> str:
    """Resolve the public backend origin used by one-click email links."""
    for key in (
        "RELEASE_EMAIL_PUBLIC_API_URL",
        "PUBLIC_API_URL",
        "BACKEND_PUBLIC_URL",
        "BACKEND_URL",
        "API_BASE_URL",
    ):
        value = os.environ.get(key)
        if value:
            return value.split(",")[0].strip()

    railway_domain = os.environ.get("RAILWAY_PUBLIC_DOMAIN")
    if railway_domain:
        railway_domain = railway_domain.strip().removeprefix("https://").removeprefix("http://")
        return f"https://{railway_domain}"

    return "https://passiveclip.com"


def unsubscribe_url(user_id: str, email: str) -> str:
    public_url = release_api_public_url()
    token = build_unsubscribe_token(user_id, email)
    return f"{public_url.rstrip('/')}/api/releases/unsubscribe?token={token}"


async def render_release_email(
    *,
    markdown: str,
    version: str,
    title: str | None,
    changelog_url: str | None,
    recipient_user_id: str = "preview",
    recipient_email: str = "preview@passiveclip.com",
    use_llm_summary: bool = False,
) -> RenderedReleaseEmail:
    headline = title or markdown_title(markdown, version)
    points = None
    if use_llm_summary:
        points = await maybe_summarise_with_llm(markdown, version, headline)
    points = points or markdown_to_email_points(markdown)
    intro = f"Here are the latest PassiveClip improvements in {version}."
    subject = f"PassiveClip {version}: new updates"
    cta_url = changelog_url or (os.environ.get("PUBLIC_APP_URL") or "https://passiveclip.com")
    cta_label = "Open PassiveClip"
    summary_text = "\n".join(f"- {point}" for point in points)
    body_html = markdown_to_email_body_html(markdown)
    template = TEMPLATE_PATH.read_text(encoding="utf-8")
    unsub_url = unsubscribe_url(recipient_user_id, recipient_email)
    html_body = _render_template(
        template,
        {
            "subject": html.escape(subject),
            "headline": html.escape(headline),
            "intro": html.escape(intro),
            "body_html": body_html,
            "cta_url": html.escape(cta_url),
            "cta_label": html.escape(cta_label),
            "unsubscribe_url": html.escape(unsub_url),
        },
    )
    text_body = (
        f"{headline}\n\n"
        f"{intro}\n\n"
        f"{summary_text}\n\n"
        f"{cta_label}: {cta_url}\n\n"
        f"Unsubscribe: {unsub_url}\n"
    )
    return RenderedReleaseEmail(
        subject=subject,
        headline=headline,
        intro=intro,
        summary_text=summary_text,
        body_html=body_html,
        html=html_body,
        text=text_body,
    )


def _extract_auth_users(page: Any) -> list[Any]:
    if isinstance(page, list):
        return page
    if hasattr(page, "users"):
        return list(page.users or [])
    if hasattr(page, "data"):
        data = page.data
        if isinstance(data, list):
            return data
        if hasattr(data, "users"):
            return list(data.users or [])
    return []


def get_subscribed_recipients(db: Any) -> list[Recipient]:
    """Read signed-up users plus invited emails; missing prefs default to subscribed."""
    auth_page = db.auth.admin.list_users()
    users = _extract_auth_users(auth_page)

    def _field(user: Any, key: str) -> Any:
        if isinstance(user, dict):
            return user.get(key)
        return getattr(user, key, None)

    user_ids = [str(_field(user, "id") or "") for user in users]
    prefs_by_user: dict[str, dict[str, Any]] = {}
    if user_ids:
        prefs = (
            db.table("email_update_preferences")
            .select("user_id, subscribed_to_product_updates")
            .in_("user_id", user_ids)
            .execute()
            .data or []
        )
        prefs_by_user = {str(row["user_id"]): row for row in prefs}

    recipients: list[Recipient] = []
    seen_emails: set[str] = set()
    for user in users:
        user_id = str(_field(user, "id") or "")
        email = (_field(user, "email") or "").strip().lower()
        if not user_id or not email:
            continue
        pref = prefs_by_user.get(user_id)
        if pref is not None and pref.get("subscribed_to_product_updates") is False:
            continue
        recipients.append(Recipient(user_id=user_id, email=email, source="auth"))
        seen_emails.add(email)

    invite_rows = (
        db.table("trial_invites")
        .select("email")
        .execute()
        .data or []
    )
    invite_emails = sorted({
        str(row.get("email") or "").strip().lower()
        for row in invite_rows
        if str(row.get("email") or "").strip()
    })
    suppressed_rows = (
        db.table("email_update_suppressions")
        .select("email")
        .in_("email", invite_emails)
        .execute()
        .data or []
    ) if invite_emails else []
    suppressed_emails = {
        str(row.get("email") or "").strip().lower()
        for row in suppressed_rows
    }
    for email in invite_emails:
        if email in seen_emails or email in suppressed_emails:
            continue
        recipients.append(Recipient(email=email, source="trial_invite"))
        seen_emails.add(email)

    return recipients


async def send_resend_email(*, to_email: str, subject: str, html_body: str, text_body: str) -> str:
    api_key = os.environ.get("RESEND_API_KEY")
    if not api_key:
        raise RuntimeError("RESEND_API_KEY not configured.")
    from_email = os.environ.get("RELEASE_RESEND_FROM_EMAIL") or os.environ.get("RESEND_FROM_EMAIL") or DEFAULT_FROM
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(
            RESEND_API_URL,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "from": from_email,
                "to": [to_email],
                "subject": subject,
                "html": html_body,
                "text": text_body,
            },
        )
    if not response.is_success:
        raise RuntimeError(f"Resend error {response.status_code}: {response.text[:1000]}")
    data = response.json()
    return data.get("id") or str(uuid4())


async def send_preview_email(db: Any, *, release: dict[str, Any], preview_email: str, triggered_by: str | None = None) -> dict[str, Any]:
    preview_render = await render_release_email(
        markdown=release.get("markdown_content") or "",
        version=release["version"],
        title=release.get("title"),
        changelog_url=release.get("changelog_url"),
        recipient_user_id="preview",
        recipient_email=preview_email,
        use_llm_summary=False,
    )
    email_id = await send_resend_email(
        to_email=preview_email,
        subject=release["email_subject"] or preview_render.subject,
        html_body=preview_render.html,
        text_body=preview_render.text,
    )
    job = (
        db.table("release_broadcast_jobs")
        .insert({
            "release_id": release["id"],
            "triggered_by": triggered_by,
            "status": "preview_sent",
            "preview_recipient_email": preview_email,
            "resend_batch_id": email_id,
            "completed_at": utc_now(),
        })
        .execute()
        .data[0]
    )
    return job


async def send_broadcast_job(db: Any, *, release_id: str, job_id: str, batch_size: int = 50) -> None:
    """Background sender. Safe to retry; sent/skipped rows are never resent."""
    try:
        release_rows = db.table("release_announcements").select("*").eq("id", release_id).execute().data or []
        if not release_rows:
            raise RuntimeError("Release not found.")
        release = release_rows[0]
        db.table("release_broadcast_jobs").update({
            "status": "sending",
            "started_at": utc_now(),
        }).eq("id", job_id).execute()
        db.table("release_announcements").update({"status": "sending"}).eq("id", release_id).execute()

        recipients = get_subscribed_recipients(db)
        db.table("release_broadcast_jobs").update({"total_recipients": len(recipients)}).eq("id", job_id).execute()

        sent_count = 0
        failed_count = 0

        for idx in range(0, len(recipients), batch_size):
            chunk = recipients[idx:idx + batch_size]
            pending_rows: list[tuple[Recipient, str]] = []
            for recipient in chunk:
                existing = (
                    db.table("release_broadcast_recipients")
                    .select("id, send_status")
                    .eq("release_id", release_id)
                    .eq("email", recipient.email)
                    .execute()
                    .data or []
                )
                if existing and existing[0].get("send_status") == "sent":
                    continue
                if existing:
                    row_id = existing[0]["id"]
                else:
                    inserted = (
                        db.table("release_broadcast_recipients")
                        .insert({
                            "broadcast_job_id": job_id,
                            "release_id": release_id,
                            "user_id": recipient.user_id,
                            "email": recipient.email,
                            "send_status": "pending",
                        })
                        .execute()
                        .data
                    )
                    if not inserted:
                        continue
                    row_id = inserted[0]["id"]
                pending_rows.append((recipient, row_id))

            for recipient, row_id in pending_rows:
                try:
                    rendered = await render_release_email(
                        markdown=release.get("markdown_content") or "",
                        version=release["version"],
                        title=release.get("title"),
                        changelog_url=release.get("changelog_url"),
                        recipient_user_id=recipient.unsubscribe_user_id,
                        recipient_email=recipient.email,
                        use_llm_summary=False,
                    )
                    email_id = await send_resend_email(
                        to_email=recipient.email,
                        subject=release["email_subject"] or rendered.subject,
                        html_body=rendered.html,
                        text_body=rendered.text,
                    )
                    db.table("release_broadcast_recipients").update({
                        "send_status": "sent",
                        "resend_email_id": email_id,
                        "sent_at": utc_now(),
                        "error_message": None,
                    }).eq("id", row_id).execute()
                    sent_count += 1
                except Exception as exc:
                    logger.exception("Release email failed for %s: %s", recipient.email, exc)
                    db.table("release_broadcast_recipients").update({
                        "send_status": "failed",
                        "error_message": str(exc)[:1000],
                    }).eq("id", row_id).execute()
                    failed_count += 1

            db.table("release_broadcast_jobs").update({
                "sent_count": sent_count,
                "failed_count": failed_count,
            }).eq("id", job_id).execute()
            await asyncio.sleep(float(os.environ.get("RELEASE_EMAIL_BATCH_PAUSE_SECONDS", "0.25")))

        final_status = "completed" if failed_count == 0 else "partially_failed"
        release_status = "sent" if failed_count == 0 else "failed"
        db.table("release_broadcast_jobs").update({
            "status": final_status,
            "sent_count": sent_count,
            "failed_count": failed_count,
            "completed_at": utc_now(),
        }).eq("id", job_id).execute()
        db.table("release_announcements").update({"status": release_status}).eq("id", release_id).execute()
    except Exception as exc:
        logger.exception("Release broadcast job failed: %s", exc)
        db.table("release_broadcast_jobs").update({
            "status": "failed",
            "failed_count": 1,
            "completed_at": utc_now(),
        }).eq("id", job_id).execute()
        db.table("release_announcements").update({"status": "failed"}).eq("id", release_id).execute()
