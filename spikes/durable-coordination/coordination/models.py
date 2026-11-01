from django.db import models


class Job(models.Model):
    id = models.CharField(primary_key=True, max_length=140)
    batch_id = models.CharField(max_length=64)
    job_id = models.CharField(max_length=64)
    current_attempt = models.CharField(max_length=80)
    input_revision = models.CharField(max_length=64)
    state = models.CharField(max_length=32, default="queued")


class Intent(models.Model):
    """Immutable command payload and original manifest bytes; state is on Job."""

    id = models.CharField(primary_key=True, max_length=80)
    job = models.ForeignKey(Job, on_delete=models.PROTECT)
    attempt_id = models.CharField(max_length=64)
    payload = models.JSONField()
    payload_digest = models.CharField(max_length=64)
    input_bytes = models.BinaryField()
    app_version = models.CharField(max_length=64)


class Outbox(models.Model):
    intent = models.OneToOneField(Intent, on_delete=models.PROTECT, primary_key=True)
    acknowledged = models.BooleanField(default=False)
    deliveries = models.PositiveIntegerField(default=0)


class Emission(models.Model):
    id = models.CharField(primary_key=True, max_length=110)
    intent = models.ForeignKey(Intent, on_delete=models.PROTECT)
    sequence = models.PositiveIntegerField()
    payload = models.JSONField()
    digest = models.CharField(max_length=64)


class Question(models.Model):
    id = models.CharField(primary_key=True, max_length=150)
    intent = models.ForeignKey(Intent, on_delete=models.PROTECT)
    payload = models.JSONField()
    answer = models.JSONField(null=True)
