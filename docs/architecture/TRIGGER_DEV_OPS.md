# Trigger.dev cloud project disable

Ritual no longer ships Trigger.dev code. FastAPI cron in `apps/backend` is the only scheduler.

After the next production deploy from `codex/release-0.1.1-prep`:

1. Open the Ritual Trigger.dev cloud project.
2. Pause or delete every remaining cloud job/schedule.
3. Disable or delete the project so it cannot fire wearable/SMS/report jobs in parallel with FastAPI.
4. Confirm Railway FastAPI still runs `background_tasks.py` / `secondary_job_runner.py`.

This repository cannot complete that ops step. There is no Trigger.dev SDK, config, or secret in the tree anymore; the cloud project is an external leftover.
