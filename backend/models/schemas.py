"""
schemas.py

Pydantic v2 request and response models.

Security considerations:
- search_terms length is bounded (max 20 terms, each max 200 chars) to prevent
  API abuse / excessive Unsplash queries from a single request.
- resolution is constrained to an allowlist — arbitrary dimensions are rejected.
- Numeric fields have explicit min/max bounds to prevent degenerate inputs
  (e.g. seconds_per_image=0 would cause a division-by-zero in pick_images_for_duration).
- output_url is Optional — only populated when status='done'. The frontend should
  never construct its own download URLs.
"""

from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, Field, field_validator


ALLOWED_RESOLUTIONS = {"1080x1920", "1920x1080", "1080x1080"}
ALLOWED_COLOR_THEMES = {"none", "warm", "dark", "grey", "blue", "red", "bw", "sepia", "low_exp"}
ALLOWED_ACCENT_FOLDERS = {"blue", "red", "gold"}
ALLOWED_IMAGE_SOURCES = {"unsplash", "pexels", "both"}


class GenerateRequest(BaseModel):
    search_terms: List[str] = Field(
        ...,
        min_length=1,
        max_length=20,
        description="Unsplash search queries (1–20 terms).",
    )
    resolution: str = Field(default="1080x1920")
    seconds_per_image: float = Field(default=0.3, ge=0.05, le=5.0)
    total_seconds: float = Field(default=3.0, ge=1.0, le=120.0)
    fps: int = Field(default=30, ge=15, le=60)
    allow_repeats: bool = True
    color_theme: str = Field(default="none")
    max_per_query: int = Field(default=3, ge=1, le=30)
    batch_title: Optional[str] = Field(default=None, max_length=120)
    uploaded_image_paths: Optional[List[str]] = None
    preset_name: Optional[str] = Field(default=None, max_length=60)
    uploaded_only: bool = False
    accent_folder: Optional[str] = Field(default=None)
    image_source: str = Field(default="unsplash")

    @field_validator("search_terms")
    @classmethod
    def validate_terms(cls, v: List[str]) -> List[str]:
        for term in v:
            if len(term) > 200:
                raise ValueError("Each search term must be ≤ 200 characters.")
            if not term.strip():
                raise ValueError("Search terms must not be blank.")
        return [t.strip() for t in v]

    @field_validator("resolution")
    @classmethod
    def validate_resolution(cls, v: str) -> str:
        if v not in ALLOWED_RESOLUTIONS:
            raise ValueError(f"resolution must be one of: {', '.join(sorted(ALLOWED_RESOLUTIONS))}")
        return v

    @field_validator("color_theme")
    @classmethod
    def validate_color_theme(cls, v: str) -> str:
        if v not in ALLOWED_COLOR_THEMES:
            raise ValueError(f"color_theme must be one of: {', '.join(sorted(ALLOWED_COLOR_THEMES))}")
        return v

    @field_validator("accent_folder")
    @classmethod
    def validate_accent_folder(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in ALLOWED_ACCENT_FOLDERS:
            raise ValueError(f"accent_folder must be one of: {', '.join(sorted(ALLOWED_ACCENT_FOLDERS))}")
        return v

    @field_validator("image_source")
    @classmethod
    def validate_image_source(cls, v: str) -> str:
        if v not in ALLOWED_IMAGE_SOURCES:
            raise ValueError(f"image_source must be one of: {', '.join(sorted(ALLOWED_IMAGE_SOURCES))}")
        return v


class JobStatusResponse(BaseModel):
    job_id: str
    status: str
    progress_message: Optional[str] = None
    output_url: Optional[str] = None
    thumbnail_url: Optional[str] = None
    error_message: Optional[str] = None
    batch_title: Optional[str] = None
    # Config fields extracted from JSONB for display
    color_theme: Optional[str] = None
    resolution: Optional[str] = None
    seconds_per_image: Optional[float] = None
    total_seconds: Optional[float] = None
    preset_name: Optional[str] = None
    created_at: datetime
    completed_at: Optional[datetime] = None


class JobListItem(BaseModel):
    job_id: str
    status: str
    progress_message: Optional[str] = None
    output_url: Optional[str] = None
    thumbnail_url: Optional[str] = None
    batch_title: Optional[str] = None
    search_terms: Optional[List[str]] = None
    resolution: Optional[str] = None
    seconds_per_image: Optional[float] = None
    total_seconds: Optional[float] = None
    fps: Optional[int] = None
    allow_repeats: Optional[bool] = None
    color_theme: Optional[str] = None
    max_per_query: Optional[int] = None
    preset_name: Optional[str] = None
    created_at: datetime
    completed_at: Optional[datetime] = None


class GenerateResponse(BaseModel):
    job_id: str
    status: Literal["queued"] = "queued"


class PreviewBatchRequest(BaseModel):
    search_terms: List[str] = Field(..., min_length=1, max_length=20)
    batch_title: Optional[str] = Field(default=None, max_length=120)
    uploaded_image_paths: Optional[List[str]] = None

    @field_validator("search_terms")
    @classmethod
    def validate_terms(cls, v: List[str]) -> List[str]:
        for term in v:
            if len(term) > 200:
                raise ValueError("Each search term must be ≤ 200 characters.")
            if not term.strip():
                raise ValueError("Search terms must not be blank.")
        return [t.strip() for t in v]


class PreviewStageRequest(BaseModel):
    batches: List[PreviewBatchRequest] = Field(..., min_length=1, max_length=10)
    resolution: str = Field(default="1080x1920")
    seconds_per_image: float = Field(default=0.3, ge=0.05, le=5.0)
    total_seconds: float = Field(default=3.0, ge=1.0, le=120.0)
    max_per_query: int = Field(default=3, ge=1, le=30)
    color_theme: str = Field(default="none")
    image_source: str = Field(default="unsplash")

    @field_validator("resolution")
    @classmethod
    def validate_resolution(cls, v: str) -> str:
        if v not in ALLOWED_RESOLUTIONS:
            raise ValueError(f"resolution must be one of: {', '.join(sorted(ALLOWED_RESOLUTIONS))}")
        return v

    @field_validator("color_theme")
    @classmethod
    def validate_color_theme(cls, v: str) -> str:
        if v not in ALLOWED_COLOR_THEMES:
            raise ValueError(f"color_theme must be one of: {', '.join(sorted(ALLOWED_COLOR_THEMES))}")
        return v

    @field_validator("image_source")
    @classmethod
    def validate_image_source(cls, v: str) -> str:
        if v not in ALLOWED_IMAGE_SOURCES:
            raise ValueError(f"image_source must be one of: {', '.join(sorted(ALLOWED_IMAGE_SOURCES))}")
        return v


class PreviewImageItem(BaseModel):
    storage_path: str
    signed_url: str


class PreviewBatchResult(BaseModel):
    batch_title: Optional[str]
    search_terms: List[str]
    images: List[PreviewImageItem]


class PreviewStageResponse(BaseModel):
    batches: List[PreviewBatchResult]
    pexels_fallback: bool = False
