import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from services.memory_turbopuffer_service import TurbopufferService


class TurbopufferParserTests(unittest.TestCase):
    def test_parse_rows_with_top_level_attributes(self):
        service = TurbopufferService()
        payload = {
            "results": [
                {
                    "rows": [
                        {
                            "id": "doc-1",
                            "$dist": 0.2,
                            "chunk_id": "chunk-1",
                            "logical_chunk_id": "logical-1",
                            "text_compact": "hello world",
                            "app_name": "Cursor",
                        }
                    ]
                }
            ]
        }

        rows = service._parse_query_results(payload)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["doc_id"], "doc-1")
        self.assertEqual(rows[0]["chunk_id"], "chunk-1")
        self.assertEqual(rows[0]["logical_chunk_id"], "logical-1")
        self.assertGreater(rows[0]["score"], 0.0)

    def test_parse_rows_with_nested_attributes_and_multi_query(self):
        service = TurbopufferService()
        payload = {
            "results": [
                {
                    "rows": [
                        {
                            "id": "doc-1",
                            "score": 0.9,
                            "attributes": {
                                "chunk_id": "chunk-1",
                                "logical_chunk_id": "logical-1",
                                "text_compact": "alpha",
                            },
                        }
                    ]
                },
                {
                    "rows": [
                        {
                            "id": "doc-1",
                            "score": 0.4,
                            "attributes": {
                                "chunk_id": "chunk-1",
                                "logical_chunk_id": "logical-1",
                            },
                        },
                        {
                            "id": "doc-2",
                            "score": 0.8,
                            "attributes": {
                                "chunk_id": "chunk-2",
                                "logical_chunk_id": "logical-2",
                                "text_compact": "beta",
                            },
                        },
                    ]
                },
            ]
        }

        rows = service._parse_query_results(payload)
        self.assertEqual([row["doc_id"] for row in rows], ["doc-1", "doc-2"])
        self.assertEqual(rows[0]["score"], 0.9)
        self.assertEqual(rows[1]["logical_chunk_id"], "logical-2")


if __name__ == "__main__":
    unittest.main()
