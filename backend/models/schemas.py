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

import re
from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator


ALLOWED_RESOLUTIONS = {"1080x1920", "1920x1080", "1080x1080"}
ALLOWED_COLOR_THEMES = {"none", "warm", "dark", "grey", "blue", "red", "bw", "sepia", "low_exp", "custom"}
ALLOWED_ACCENT_FOLDERS = {"blue", "red", "gold"}
ALLOWED_IMAGE_SOURCES = {"unsplash", "pexels", "both"}
ALLOWED_PHILOSOPHERS = {"marcus_aurelius", "seneca", "epictetus", "nietzsche", "socrates", "aristotle"}
ALLOWED_OVERLAY_FONTS = {
    "garamond", "cormorant", "playfair", "crimson", "philosopher", "lora",
    "outfit", "raleway", "josefin", "inter",
    "cinzel", "cinzel_deco", "uncial",
    "jetbrains", "space_mono",
}
ALLOWED_OVERLAY_COLORS = {"white", "cream", "gold", "black", "custom"}
ALLOWED_OVERLAY_POSITIONS = {
    "top-left", "top-center", "top-right",
    "middle-left", "middle-center", "middle-right",
    "bottom-left", "bottom-center", "bottom-right",
}
ALLOWED_OVERLAY_ALIGNMENTS = {"left", "center", "right"}


class TextOverlayConfig(BaseModel):
    """Text caption burned into the video via ffmpeg drawtext filter."""
    enabled: bool = True
    text: str = Field(..., max_length=200)
    font: str = Field(default="serif")
    color: str = Field(default="white")
    custom_color: Optional[str] = None
    background_box: bool = False
    position: str = Field(default="bottom-center")
    alignment: str = Field(default="center")
    font_size_pct: float = Field(default=0.045, ge=0.01, le=0.2)

    @field_validator("font")
    @classmethod
    def validate_font(cls, v: str) -> str:
        if v not in ALLOWED_OVERLAY_FONTS:
            raise ValueError(f"font must be one of: {', '.join(sorted(ALLOWED_OVERLAY_FONTS))}")
        return v

    @field_validator("color")
    @classmethod
    def validate_color(cls, v: str) -> str:
        if v not in ALLOWED_OVERLAY_COLORS:
            raise ValueError(f"color must be one of: {', '.join(sorted(ALLOWED_OVERLAY_COLORS))}")
        return v

    @field_validator("position")
    @classmethod
    def validate_position(cls, v: str) -> str:
        if v not in ALLOWED_OVERLAY_POSITIONS:
            raise ValueError(f"position must be one of: {', '.join(sorted(ALLOWED_OVERLAY_POSITIONS))}")
        return v

    @field_validator("alignment")
    @classmethod
    def validate_alignment(cls, v: str) -> str:
        if v not in ALLOWED_OVERLAY_ALIGNMENTS:
            raise ValueError(f"alignment must be one of: {', '.join(sorted(ALLOWED_OVERLAY_ALIGNMENTS))}")
        return v

    @field_validator("custom_color")
    @classmethod
    def validate_custom_color(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not re.match(r"^#[0-9a-fA-F]{6}$", v):
            raise ValueError("custom_color must be a 6-digit hex color like #ff0000")
        return v


class CustomGradeParams(BaseModel):
    """User-defined parametric colour grade applied via grade_custom() in image_grader.py."""
    brightness: float = Field(default=1.0, ge=0.0, le=2.0)
    contrast:   float = Field(default=1.0, ge=0.0, le=2.0)
    saturation: float = Field(default=1.0, ge=0.0, le=2.0)
    exposure:   float = Field(default=1.0, ge=0.5, le=1.5)
    warmth:     float = Field(default=0.0, ge=-1.0, le=1.0)
    tint:       float = Field(default=0.0, ge=-1.0, le=1.0)
    hue_shift:  float = Field(default=0.0, ge=-180.0, le=180.0)


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
    custom_grade_params: Optional[CustomGradeParams] = None
    philosopher: Optional[str] = Field(default=None)
    grade_philosopher: bool = False
    text_overlay: Optional[TextOverlayConfig] = None

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

    @field_validator("philosopher")
    @classmethod
    def validate_philosopher(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in ALLOWED_PHILOSOPHERS:
            raise ValueError(f"philosopher must be one of: {', '.join(sorted(ALLOWED_PHILOSOPHERS))}")
        return v

    @model_validator(mode="after")
    def check_custom_params(self) -> "GenerateRequest":
        if self.color_theme == "custom" and self.custom_grade_params is None:
            raise ValueError("custom_grade_params is required when color_theme is 'custom'")
        return self


class JobStatusResponse(BaseModel):
    job_id: str
    status: str
    progress_message: Optional[str] = None
    output_url: Optional[str] = None
    thumbnail_url: Optional[str] = None
    error_message: Optional[str] = None
    batch_title: Optional[str] = None
    # Config fields extracted from JSONB for display
    search_terms: Optional[List[str]] = None
    color_theme: Optional[str] = None
    resolution: Optional[str] = None
    seconds_per_image: Optional[float] = None
    total_seconds: Optional[float] = None
    max_per_query: Optional[int] = None
    preset_name: Optional[str] = None
    preview_images: Optional[List[str]] = None
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
    color_theme: Optional[str] = None
    custom_grade_params: Optional[CustomGradeParams] = None

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


ALLOWED_TRANSITIONS = {"cut", "fade_black", "crossfade"}


class ClipTrim(BaseModel):
    """A single Pexels video clip with optional trim points."""
    id: str = Field(..., pattern=r'^pv_\d+$')
    download_url: str
    trim_start: float = Field(default=0.0, ge=0.0, le=600.0)
    trim_end: float = Field(default=0.0, ge=0.0, le=600.0)   # 0 = use full clip duration
    duration: int = Field(..., ge=1, le=600)

    @field_validator("download_url")
    @classmethod
    def validate_download_url(cls, v: str) -> str:
        if not v.startswith("https://videos.pexels.com/"):
            raise ValueError("download_url must be a Pexels video URL")
        return v


class ClipGenerateRequest(BaseModel):
    clips: List[ClipTrim] = Field(..., min_length=1, max_length=20)
    resolution: str = Field(default="1080x1920")
    fps: int = Field(default=30, ge=15, le=60)
    color_theme: str = Field(default="none")
    transition: str = Field(default="cut")
    transition_duration: float = Field(default=0.5, ge=0.2, le=2.0)
    batch_title: Optional[str] = Field(default=None, max_length=120)
    text_overlay: Optional[TextOverlayConfig] = None

    @field_validator("resolution")
    @classmethod
    def validate_resolution(cls, v: str) -> str:
        if v not in ALLOWED_RESOLUTIONS:
            raise ValueError(f"resolution must be one of: {', '.join(sorted(ALLOWED_RESOLUTIONS))}")
        return v

    @field_validator("color_theme")
    @classmethod
    def validate_color_theme(cls, v: str) -> str:
        # clips mode doesn't support 'custom' grade (PIL-based, not applicable to video)
        allowed = ALLOWED_COLOR_THEMES - {"custom"}
        if v not in allowed:
            raise ValueError(f"color_theme must be one of: {', '.join(sorted(allowed))}")
        return v

    @field_validator("transition")
    @classmethod
    def validate_transition(cls, v: str) -> str:
        if v not in ALLOWED_TRANSITIONS:
            raise ValueError(f"transition must be one of: {', '.join(sorted(ALLOWED_TRANSITIONS))}")
        return v


class ClipSearchResult(BaseModel):
    id: str
    duration: int
    thumbnail: str
    preview_url: str
    download_url: str
    width: int
    height: int


class ClipSearchResponse(BaseModel):
    clips: List[ClipSearchResult]


ALLOWED_PRIVACY_LEVELS = {
    "PUBLIC_TO_EVERYONE",
    "MUTUAL_FOLLOW_FRIENDS",
    "FOLLOWER_OF_CREATOR",
    "SELF_ONLY",
}


class SchedulePostRequest(BaseModel):
    job_id: str
    tiktok_account_id: str
    caption: str = Field(default="", max_length=2200)
    hashtags: List[str] = Field(default=[])
    privacy_level: str = Field(default="PUBLIC_TO_EVERYONE")
    scheduled_at: datetime
    draft_mode: bool = False

    @field_validator("privacy_level")
    @classmethod
    def validate_privacy_level(cls, v: str) -> str:
        if v not in ALLOWED_PRIVACY_LEVELS:
            raise ValueError(f"privacy_level must be one of: {', '.join(sorted(ALLOWED_PRIVACY_LEVELS))}")
        return v
