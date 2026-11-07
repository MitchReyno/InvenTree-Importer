from django.db import models


class Approval(models.Model):
    """Immutable-by-command API, not a malicious DBA defense."""

    id = models.CharField(primary_key=True, max_length=64)
    research = models.ForeignKey("coordination.Intent", on_delete=models.PROTECT)
    payload = models.JSONField()
    workspace = models.TextField()
    command_digest = models.CharField(max_length=64)
    version = models.CharField(max_length=64)


class ApplyOutbox(models.Model):
    approval = models.OneToOneField(Approval, on_delete=models.PROTECT, primary_key=True)
    acknowledged = models.BooleanField(default=False)
    conflict = models.CharField(max_length=64, default="")


class Projection(models.Model):
    approval = models.OneToOneField(Approval, on_delete=models.PROTECT, primary_key=True)
    cursor = models.PositiveIntegerField(default=0)
    disposition = models.CharField(max_length=40)
    snapshot = models.JSONField(null=True)
