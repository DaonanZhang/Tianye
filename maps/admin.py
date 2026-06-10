from django.contrib import admin

from .models import HikeSession, SavedPath, ScenicSpot


@admin.register(ScenicSpot)
class ScenicSpotAdmin(admin.ModelAdmin):
    list_display = ("name", "category", "subcategory", "source_object_type", "source_object_id")
    list_filter = ("category", "subcategory", "source")
    search_fields = ("name",)


@admin.register(HikeSession)
class HikeSessionAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "status",
        "started_at",
        "ended_at",
        "planned_distance_meters",
        "walked_distance_meters",
        "completion_ratio",
        "deviation_count",
    )
    list_filter = ("status",)
    readonly_fields = ("created_at", "updated_at")


@admin.register(SavedPath)
class SavedPathAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "status", "source", "distance_meters", "merged_into", "created_at")
    list_filter = ("status", "source")
    search_fields = ("name",)
    readonly_fields = ("created_at", "updated_at")
