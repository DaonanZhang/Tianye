from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True

    dependencies = []

    operations = [
        migrations.CreateModel(
            name="ScenicSpot",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("source", models.CharField(default="osm", max_length=32)),
                ("source_object_type", models.CharField(max_length=16)),
                ("source_object_id", models.BigIntegerField()),
                ("name", models.CharField(max_length=255)),
                ("category", models.CharField(max_length=64)),
                ("subcategory", models.CharField(blank=True, max_length=64)),
                ("longitude", models.FloatField()),
                ("latitude", models.FloatField()),
                ("raw_tags", models.JSONField(blank=True, default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={"ordering": ["name", "id"]},
        ),
        migrations.AddConstraint(
            model_name="scenicspot",
            constraint=models.UniqueConstraint(
                fields=("source", "source_object_type", "source_object_id"),
                name="unique_scenic_spot_source_object",
            ),
        ),
    ]
