import pytest

from app.core.errors import AppError, JobNotFoundError
from app.schemas.job import JobStatus
from app.utils import job_manager


def test_create_and_get_job():
    job = job_manager.create_job(original_filename="video.mp4")
    assert job.status == JobStatus.PENDING
    assert job_manager.get_job(job.id).id == job.id


def test_get_missing_job_raises():
    with pytest.raises(JobNotFoundError):
        job_manager.get_job("does-not-exist")


def test_update_job_changes_fields():
    job = job_manager.create_job()
    updated = job_manager.update_job(job.id, progress_percent=42.0)
    assert updated.progress_percent == 42.0
    assert updated.updated_at >= job.updated_at


def test_claim_for_processing_is_exclusive():
    job = job_manager.create_job()
    claimed = job_manager.claim_for_processing(job.id)
    assert claimed.status == JobStatus.PROCESSING
    # A second claim (e.g. a concurrent /convert call) must fail.
    with pytest.raises(AppError):
        job_manager.claim_for_processing(job.id)


def test_claim_rejects_completed_job():
    job = job_manager.create_job()
    job_manager.update_job(job.id, status=JobStatus.COMPLETED)
    with pytest.raises(AppError):
        job_manager.claim_for_processing(job.id)


def test_failed_job_can_be_reclaimed():
    job = job_manager.create_job()
    job_manager.mark_failed(job.id, "internal_error", "boom")
    reclaimed = job_manager.claim_for_processing(job.id)
    assert reclaimed.status == JobStatus.PROCESSING


def test_finished_jobs_are_pruned():
    finished_ids = []
    for _ in range(job_manager._MAX_FINISHED_JOBS + 5):
        job = job_manager.create_job()
        job_manager.update_job(job.id, status=JobStatus.COMPLETED)
        finished_ids.append(job.id)

    # Creating one more job triggers pruning of the oldest finished jobs.
    job_manager.create_job()
    remaining = [jid for jid in finished_ids if jid in job_manager._jobs]
    assert len(remaining) == job_manager._MAX_FINISHED_JOBS
    # The oldest were evicted, the newest kept.
    assert finished_ids[0] not in job_manager._jobs
    assert finished_ids[-1] in job_manager._jobs


def test_cancel_flag_roundtrip():
    job = job_manager.create_job()
    assert not job_manager.is_cancel_requested(job.id)
    job_manager.request_cancel(job.id)
    assert job_manager.is_cancel_requested(job.id)
