"""Regression coverage for a single, deployable Alembic migration chain."""

from __future__ import annotations

from pathlib import Path
import unittest

from alembic.config import Config
from alembic.script import ScriptDirectory


BACKEND_ROOT = Path(__file__).resolve().parents[1]


class MigrationLineageTests(unittest.TestCase):
    def test_production_migrations_have_one_linear_head(self):
        config = Config(str(BACKEND_ROOT / "alembic.ini"))
        scripts = ScriptDirectory.from_config(config)

        self.assertEqual(scripts.get_heads(), ["20260729_0003"])

        revisions = list(scripts.walk_revisions())
        revision_ids = [revision.revision for revision in revisions]
        self.assertEqual(len(revision_ids), len(set(revision_ids)))

        provenance = scripts.get_revision("20260729_0003")
        self.assertIsNotNone(provenance)
        self.assertEqual(provenance.down_revision, "20260729_0002")


if __name__ == "__main__":
    unittest.main()
