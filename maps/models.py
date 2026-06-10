from django.db import models
from django.utils import timezone


class ScenicSpot(models.Model):
    source = models.CharField(max_length=32, default="osm")
    source_object_type = models.CharField(max_length=16)
    source_object_id = models.BigIntegerField()
    name = models.CharField(max_length=255)
    category = models.CharField(max_length=64)
    subcategory = models.CharField(max_length=64, blank=True)
    longitude = models.FloatField()
    latitude = models.FloatField()
    raw_tags = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["source", "source_object_type", "source_object_id"],
                name="unique_scenic_spot_source_object",
            )
        ]
        ordering = ["name", "id"]

    def __str__(self) -> str:
        return self.name


class HikeSession(models.Model):
    STATUS_ACTIVE = "active"
    STATUS_COMPLETED = "completed"

    STATUS_CHOICES = [
        (STATUS_ACTIVE, "Active"),
        (STATUS_COMPLETED, "Completed"),
    ]

    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default=STATUS_ACTIVE)
    started_at = models.DateTimeField(default=timezone.now)
    ended_at = models.DateTimeField(null=True, blank=True)

    planned_route = models.JSONField(default=dict, blank=True)
    actual_track = models.JSONField(default=dict, blank=True)

    start_longitude = models.FloatField()
    start_latitude = models.FloatField()
    end_longitude = models.FloatField()
    end_latitude = models.FloatField()

    planned_distance_meters = models.FloatField(default=0.0)
    walked_distance_meters = models.FloatField(default=0.0)
    planned_ascent_meters = models.FloatField(default=0.0)
    planned_descent_meters = models.FloatField(default=0.0)
    walked_route_distance_meters = models.FloatField(default=0.0)
    completion_ratio = models.FloatField(default=0.0)
    deviation_count = models.PositiveIntegerField(default=0)

    planned_moving_minutes = models.PositiveIntegerField(default=0)
    planned_recommended_minutes = models.PositiveIntegerField(default=0)
    actual_duration_seconds = models.PositiveIntegerField(default=0)

    route_metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-started_at", "-id"]

    def __str__(self) -> str:
        started = self.started_at.astimezone(timezone.get_current_timezone()).strftime("%Y-%m-%d %H:%M")
        return f"HikeSession #{self.pk} {started}"


class SavedPath(models.Model):
    STATUS_CANONICAL = "canonical"
    STATUS_MERGED = "merged"

    STATUS_CHOICES = [
        (STATUS_CANONICAL, "Canonical"),
        (STATUS_MERGED, "Merged"),
    ]

    name = models.CharField(max_length=255)
    source = models.CharField(max_length=32, default="gpx")
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default=STATUS_CANONICAL)
    geometry = models.JSONField(default=dict)
    original_gpx = models.TextField(blank=True)
    distance_meters = models.FloatField(default=0.0)
    ascent_meters = models.FloatField(default=0.0)
    descent_meters = models.FloatField(default=0.0)
    metadata = models.JSONField(default=dict, blank=True)
    merged_into = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="merged_paths",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self) -> str:
        return self.name
