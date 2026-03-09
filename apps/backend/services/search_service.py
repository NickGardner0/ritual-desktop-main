"""
Typesense Search Service for Ritual

Provides fast, typo-tolerant search across:
- Habits (name, category, aliases)
- Habit Logs (notes, date, habit_name)
- AI Conversations (messages, topics)
- Computer Activity (app names, domains)

Features:
- Search-as-you-type (instant results)
- Fuzzy matching (typo tolerance)
- Multi-collection federated search
- Personalized ranking (recent items first)
"""

import os
import json
import hashlib
import logging
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any, Literal
import typesense
from typesense.exceptions import ObjectNotFound, TypesenseClientError

logger = logging.getLogger(__name__)

# Collection schemas
HABITS_SCHEMA = {
    "name": "habits",
    "fields": [
        {"name": "id", "type": "string"},
        {"name": "user_id", "type": "string", "facet": True},
        {"name": "name", "type": "string"},
        {"name": "name_lowercase", "type": "string"},  # For exact matching
        {"name": "category", "type": "string", "facet": True, "optional": True},
        {"name": "icon", "type": "string", "optional": True},
        {"name": "unit_type", "type": "string", "optional": True, "facet": True},
        {"name": "metric_type", "type": "string", "optional": True, "facet": True},
        {"name": "aliases", "type": "string[]", "optional": True},  # For fuzzy matching
        {"name": "is_active", "type": "bool", "facet": True},
        {"name": "goal", "type": "float", "optional": True},
        {"name": "created_at", "type": "int64"},  # Unix timestamp for sorting
        {"name": "updated_at", "type": "int64"},
        {"name": "log_count", "type": "int32", "optional": True},  # For ranking
        {"name": "last_logged_at", "type": "int64", "optional": True},  # For recency
    ],
    "default_sorting_field": "updated_at",
    "token_separators": ["-", "_", " "],
}

HABIT_LOGS_SCHEMA = {
    "name": "habit_logs",
    "fields": [
        {"name": "id", "type": "string"},
        {"name": "user_id", "type": "string", "facet": True},
        {"name": "habit_id", "type": "string", "facet": True},
        {"name": "habit_name", "type": "string"},
        {"name": "category", "type": "string", "facet": True, "optional": True},
        {"name": "date", "type": "string", "facet": True},  # YYYY-MM-DD
        {"name": "date_timestamp", "type": "int64"},  # For range queries
        {"name": "amount", "type": "float", "optional": True},
        {"name": "duration", "type": "int32", "optional": True},
        {"name": "unit_type", "type": "string", "optional": True},
        {"name": "status", "type": "string", "facet": True},
        {"name": "notes", "type": "string", "optional": True},
        {"name": "source", "type": "string", "facet": True, "optional": True},
        {"name": "created_at", "type": "int64"},
    ],
    "default_sorting_field": "date_timestamp",
    "token_separators": ["-", "_", " "],
}

AI_MESSAGES_SCHEMA = {
    "name": "ai_messages",
    "fields": [
        {"name": "id", "type": "string"},
        {"name": "user_id", "type": "string", "facet": True},
        {"name": "conversation_id", "type": "string", "facet": True},
        {"name": "role", "type": "string", "facet": True},  # user, assistant
        {"name": "content", "type": "string"},
        {"name": "content_preview", "type": "string"},  # First 200 chars for display
        {"name": "created_at", "type": "int64"},
        {"name": "topics", "type": "string[]", "optional": True, "facet": True},  # Extracted topics
    ],
    "default_sorting_field": "created_at",
}

COMPUTER_ACTIVITY_SCHEMA = {
    "name": "computer_activity",
    "fields": [
        {"name": "id", "type": "string"},
        {"name": "user_id", "type": "string", "facet": True},
        {"name": "device_id", "type": "string", "facet": True},
        {"name": "app_name", "type": "string"},
        {"name": "app_name_lowercase", "type": "string"},
        {"name": "window_title", "type": "string", "optional": True},
        {"name": "bundle_id", "type": "string", "optional": True},
        {"name": "browser_domain", "type": "string", "optional": True, "facet": True},
        {"name": "date", "type": "string", "facet": True},
        {"name": "total_ms", "type": "int64"},
        {"name": "active_ms", "type": "int64"},
        {"name": "created_at", "type": "int64"},
    ],
    "default_sorting_field": "created_at",
}

LOG_PHRASES_SCHEMA = {
    "name": "log_phrases",
    "fields": [
        {"name": "id", "type": "string"},
        {"name": "user_id", "type": "string", "facet": True},
        {"name": "habit_id", "type": "string", "facet": True},
        {"name": "habit_name", "type": "string"},
        {"name": "input_text", "type": "string"},  # Raw user input for prefix matching
        {"name": "value", "type": "float", "optional": True},
        {"name": "unit", "type": "string", "optional": True},
        {"name": "created_at", "type": "int64"},
    ],
    "default_sorting_field": "created_at",
    "token_separators": ["-", "_", " "],
}

# Unit display abbreviations for suggestion formatting
UNIT_ABBREVIATIONS = {
    "Milligrams": "mg",
    "Minutes": "min",
    "Hours": "hr",
    "Miles": "mi",
    "Pages": "pages",
    "Steps": "steps",
    "Count": "",
    "Kilometers": "km",
    "Grams": "g",
    "Kilograms": "kg",
    "Pounds": "lbs",
    "Calories": "cal",
    "Liters": "L",
    "Cups": "cups",
    "BPM": "BPM",
    "Glasses": "glasses",
    "Sets": "sets",
}

# Quick action items for command palette
QUICK_ACTIONS = [
    {"id": "log-habit", "name": "Log a habit", "keywords": ["log", "track", "add", "record"], "action": "open_logger", "icon": "plus"},
    {"id": "search-logs", "name": "Search logs", "keywords": ["find", "search", "history"], "action": "navigate", "path": "/activity", "icon": "search"},
    {"id": "view-analytics", "name": "View analytics", "keywords": ["stats", "charts", "graphs", "analytics"], "action": "navigate", "path": "/analytics", "icon": "bar-chart"},
    {"id": "ai-assistant", "name": "Ask AI assistant", "keywords": ["ai", "chat", "ask", "help", "analyze"], "action": "navigate", "path": "/chat", "icon": "bot"},
    {"id": "import-data", "name": "Import data", "keywords": ["import", "upload", "csv", "health"], "action": "open_import", "icon": "upload"},
    {"id": "connect-wearables", "name": "Connect wearables", "keywords": ["whoop", "oura", "garmin", "apple", "health", "connect"], "action": "navigate", "path": "/integrations", "icon": "watch"},
    {"id": "settings", "name": "Settings", "keywords": ["settings", "preferences", "config"], "action": "open_settings", "icon": "settings"},
    {"id": "export-data", "name": "Export data", "keywords": ["export", "download", "backup"], "action": "export", "icon": "download"},
]


class SearchService:
    """
    Typesense search service for Ritual.
    Handles indexing and searching across all collections.
    """
    
    def __init__(self):
        self.client: Optional[typesense.Client] = None
        self._initialized = False
        self._init_client()
    
    def _init_client(self):
        """Initialize Typesense client from environment variables"""
        api_key = os.getenv("TYPESENSE_API_KEY")
        host = os.getenv("TYPESENSE_HOST", "localhost")
        port = os.getenv("TYPESENSE_PORT", "8108")
        protocol = os.getenv("TYPESENSE_PROTOCOL", "http")
        
        if not api_key:
            logger.warning("⚠️ TYPESENSE_API_KEY not set - search features disabled")
            return
        
        try:
            self.client = typesense.Client({
                "api_key": api_key,
                "nodes": [{
                    "host": host,
                    "port": port,
                    "protocol": protocol,
                }],
                "connection_timeout_seconds": 5,
            })
            self._initialized = True
            logger.info(f"✅ Typesense client initialized: {protocol}://{host}:{port}")
        except Exception as e:
            logger.error(f"❌ Failed to initialize Typesense client: {e}")
    
    @property
    def is_available(self) -> bool:
        """Check if search service is available"""
        return self._initialized and self.client is not None
    
    # ================================
    # COLLECTION MANAGEMENT
    # ================================
    
    async def ensure_collections(self):
        """Create collections if they don't exist"""
        if not self.is_available:
            return
        
        schemas = [
            HABITS_SCHEMA,
            HABIT_LOGS_SCHEMA,
            AI_MESSAGES_SCHEMA,
            COMPUTER_ACTIVITY_SCHEMA,
            LOG_PHRASES_SCHEMA,
        ]
        
        for schema in schemas:
            try:
                self.client.collections[schema["name"]].retrieve()
                logger.info(f"✓ Collection '{schema['name']}' exists")
            except ObjectNotFound:
                try:
                    self.client.collections.create(schema)
                    logger.info(f"✓ Created collection '{schema['name']}'")
                except TypesenseClientError as e:
                    logger.error(f"❌ Failed to create collection '{schema['name']}': {e}")
    
    # ================================
    # INDEXING - HABITS
    # ================================
    
    async def index_habit(self, habit: Dict[str, Any], user_id: str):
        """Index a single habit"""
        if not self.is_available:
            return
        
        try:
            doc = {
                "id": habit["id"],
                "user_id": user_id,
                "name": habit.get("name", ""),
                "name_lowercase": habit.get("name", "").lower(),
                "category": habit.get("category"),
                "icon": habit.get("icon"),
                "unit_type": habit.get("unit_type"),
                "metric_type": habit.get("metric_type"),
                "aliases": habit.get("aliases", []),
                "is_active": habit.get("is_active", True),
                "goal": habit.get("goal"),
                "created_at": self._to_timestamp(habit.get("created_at")),
                "updated_at": self._to_timestamp(habit.get("updated_at") or habit.get("created_at")),
                "log_count": habit.get("log_count", 0),
                "last_logged_at": self._to_timestamp(habit.get("last_logged_at")),
            }
            
            self.client.collections["habits"].documents.upsert(doc)
        except Exception as e:
            logger.error(f"❌ Failed to index habit {habit.get('id')}: {e}")
    
    async def delete_habit_index(self, habit_id: str):
        """Remove a habit from the index"""
        if not self.is_available:
            return
        
        try:
            self.client.collections["habits"].documents[habit_id].delete()
        except ObjectNotFound:
            pass
        except Exception as e:
            logger.error(f"❌ Failed to delete habit index {habit_id}: {e}")
    
    # ================================
    # INDEXING - HABIT LOGS
    # ================================
    
    async def index_habit_log(self, log: Dict[str, Any], user_id: str, habit_name: str = None, category: str = None):
        """Index a single habit log"""
        if not self.is_available:
            return
        
        try:
            date_str = log.get("date", "")
            date_timestamp = self._date_to_timestamp(date_str)
            
            doc = {
                "id": log["id"],
                "user_id": user_id,
                "habit_id": log.get("habit_id", ""),
                "habit_name": habit_name or log.get("habit_name", ""),
                "category": category,
                "date": date_str,
                "date_timestamp": date_timestamp,
                "amount": log.get("amount"),
                "duration": log.get("duration"),
                "unit_type": log.get("unit_type"),
                "status": log.get("status", "completed"),
                "notes": log.get("notes"),
                "source": log.get("source"),
                "created_at": self._to_timestamp(log.get("created_at") or log.get("completed_at")),
            }
            
            self.client.collections["habit_logs"].documents.upsert(doc)
        except Exception as e:
            logger.error(f"❌ Failed to index habit log {log.get('id')}: {e}")
    
    async def delete_habit_log_index(self, log_id: str):
        """Remove a log from the index"""
        if not self.is_available:
            return
        
        try:
            self.client.collections["habit_logs"].documents[log_id].delete()
        except ObjectNotFound:
            pass
        except Exception as e:
            logger.error(f"❌ Failed to delete log index {log_id}: {e}")
    
    # ================================
    # INDEXING - AI MESSAGES
    # ================================
    
    async def index_ai_message(self, message: Dict[str, Any], user_id: str, topics: List[str] = None):
        """Index an AI chat message"""
        if not self.is_available:
            return
        
        try:
            content = message.get("content", "")
            doc = {
                "id": message["id"],
                "user_id": user_id,
                "conversation_id": message.get("conversation_id", ""),
                "role": message.get("role", "user"),
                "content": content,
                "content_preview": content[:200] if content else "",
                "created_at": self._to_timestamp(message.get("created_at")),
                "topics": topics or [],
            }
            
            self.client.collections["ai_messages"].documents.upsert(doc)
        except Exception as e:
            logger.error(f"❌ Failed to index AI message {message.get('id')}: {e}")
    
    # ================================
    # INDEXING - COMPUTER ACTIVITY
    # ================================
    
    async def index_activity(self, activity: Dict[str, Any], user_id: str):
        """Index computer activity data"""
        if not self.is_available:
            return
        
        try:
            doc = {
                "id": activity.get("id") or f"{user_id}_{activity.get('app_name')}_{activity.get('date')}",
                "user_id": user_id,
                "device_id": activity.get("device_id", ""),
                "app_name": activity.get("app_name", ""),
                "app_name_lowercase": activity.get("app_name", "").lower(),
                "window_title": activity.get("window_title"),
                "bundle_id": activity.get("bundle_id"),
                "browser_domain": activity.get("browser_domain"),
                "date": activity.get("date", ""),
                "total_ms": activity.get("total_ms", 0),
                "active_ms": activity.get("active_ms", 0),
                "created_at": self._to_timestamp(activity.get("created_at")),
            }
            
            self.client.collections["computer_activity"].documents.upsert(doc)
        except Exception as e:
            logger.error(f"❌ Failed to index activity: {e}")
    
    # ================================
    # INDEXING - LOG PHRASES (learned input patterns)
    # ================================
    
    async def index_log_phrase(
        self,
        user_id: str,
        input_text: str,
        habit_id: str,
        habit_name: str,
        value: float = None,
        unit: str = None,
    ):
        """
        Index a raw user log phrase for future suggestion matching.
        
        When the user types "I consumed 200mg of caffeine today" and it resolves
        to the Caffeine Consumption habit, we store the raw text. Next time
        they type "I consumed", Typesense prefix search will match it.
        """
        if not self.is_available or not input_text:
            return
        
        try:
            # Use a hash so the same phrase just gets updated, not duplicated
            doc_id = hashlib.md5(
                f"{user_id}:{input_text.lower().strip()}".encode()
            ).hexdigest()
            
            doc = {
                "id": doc_id,
                "user_id": user_id,
                "habit_id": habit_id,
                "habit_name": habit_name,
                "input_text": input_text.strip(),
                "value": value,
                "unit": unit,
                "created_at": int(datetime.utcnow().timestamp()),
            }
            
            self.client.collections["log_phrases"].documents.upsert(doc)
        except Exception as e:
            logger.warning(f"⚠️ Failed to index log phrase: {e}")
    
    # ================================
    # BULK INDEXING
    # ================================
    
    async def bulk_index_habits(self, habits: List[Dict], user_id: str):
        """Bulk index multiple habits"""
        if not self.is_available or not habits:
            return
        
        docs = []
        for habit in habits:
            docs.append({
                "id": habit["id"],
                "user_id": user_id,
                "name": habit.get("name", ""),
                "name_lowercase": habit.get("name", "").lower(),
                "category": habit.get("category"),
                "icon": habit.get("icon"),
                "unit_type": habit.get("unit_type"),
                "metric_type": habit.get("metric_type"),
                "aliases": habit.get("aliases", []),
                "is_active": habit.get("is_active", True),
                "goal": habit.get("goal"),
                "created_at": self._to_timestamp(habit.get("created_at")),
                "updated_at": self._to_timestamp(habit.get("updated_at") or habit.get("created_at")),
                "log_count": habit.get("log_count", 0),
                "last_logged_at": self._to_timestamp(habit.get("last_logged_at")),
            })
        
        try:
            self.client.collections["habits"].documents.import_(docs, {"action": "upsert"})
            logger.info(f"✓ Indexed {len(docs)} habits")
        except Exception as e:
            logger.error(f"❌ Bulk habit indexing failed: {e}")
    
    async def bulk_index_logs(self, logs: List[Dict], user_id: str):
        """Bulk index multiple habit logs"""
        if not self.is_available or not logs:
            return
        
        docs = []
        for log in logs:
            date_str = log.get("date", "")
            docs.append({
                "id": log["id"],
                "user_id": user_id,
                "habit_id": log.get("habit_id", ""),
                "habit_name": log.get("habit_name", ""),
                "category": log.get("category"),
                "date": date_str,
                "date_timestamp": self._date_to_timestamp(date_str),
                "amount": log.get("amount"),
                "duration": log.get("duration"),
                "unit_type": log.get("unit_type"),
                "status": log.get("status", "completed"),
                "notes": log.get("notes"),
                "source": log.get("source"),
                "created_at": self._to_timestamp(log.get("created_at") or log.get("completed_at")),
            })
        
        try:
            self.client.collections["habit_logs"].documents.import_(docs, {"action": "upsert"})
            logger.info(f"✓ Indexed {len(docs)} logs")
        except Exception as e:
            logger.error(f"❌ Bulk log indexing failed: {e}")
    
    # ================================
    # SEARCH - FEDERATED (GLOBAL)
    # ================================
    
    async def search_global(
        self,
        query: str,
        user_id: str,
        collections: List[str] = None,
        limit: int = 10,
    ) -> Dict[str, Any]:
        """
        Federated search across all collections.
        Returns grouped results for command palette.
        """
        if not self.is_available:
            return self._fallback_search(query)
        
        if not query or len(query.strip()) == 0:
            return self._get_recent_items(user_id, limit)
        
        collections = collections or ["habits", "habit_logs", "ai_messages"]
        
        searches = []
        
        # Search habits
        if "habits" in collections:
            searches.append({
                "collection": "habits",
                "q": query,
                "query_by": "name,name_lowercase,aliases,category",
                "filter_by": f"user_id:={user_id} && is_active:=true",
                "sort_by": "_text_match:desc,last_logged_at:desc",
                "per_page": limit,
                "highlight_full_fields": "name",
                "typo_tokens_threshold": 1,
            })
        
        # Search habit logs
        if "habit_logs" in collections:
            searches.append({
                "collection": "habit_logs",
                "q": query,
                "query_by": "habit_name,notes",
                "filter_by": f"user_id:={user_id}",
                "sort_by": "_text_match:desc,date_timestamp:desc",
                "per_page": limit,
                "highlight_full_fields": "habit_name,notes",
                "typo_tokens_threshold": 1,
            })
        
        # Search AI messages
        if "ai_messages" in collections:
            searches.append({
                "collection": "ai_messages",
                "q": query,
                "query_by": "content,topics",
                "filter_by": f"user_id:={user_id}",
                "sort_by": "_text_match:desc,created_at:desc",
                "per_page": limit,
                "highlight_full_fields": "content_preview",
                "typo_tokens_threshold": 1,
            })
        
        # Search computer activity
        if "computer_activity" in collections:
            searches.append({
                "collection": "computer_activity",
                "q": query,
                "query_by": "app_name,app_name_lowercase,browser_domain,window_title",
                "filter_by": f"user_id:={user_id}",
                "sort_by": "_text_match:desc,total_ms:desc",
                "per_page": limit,
                "highlight_full_fields": "app_name,browser_domain",
                "typo_tokens_threshold": 1,
            })
        
        try:
            results = self.client.multi_search.perform({"searches": searches}, {})
            
            # Also search quick actions
            quick_action_results = self._search_quick_actions(query)
            
            return {
                "query": query,
                "quick_actions": quick_action_results,
                "habits": self._format_results(results.get("results", [{}])[0] if len(searches) > 0 else {}),
                "logs": self._format_results(results.get("results", [{}])[1] if len(searches) > 1 else {}),
                "conversations": self._format_results(results.get("results", [{}])[2] if len(searches) > 2 else {}),
                "activity": self._format_results(results.get("results", [{}])[3] if len(searches) > 3 else {}),
            }
        except Exception as e:
            logger.error(f"❌ Search failed: {e}")
            return self._fallback_search(query)
    
    # ================================
    # SEARCH - HABITS ONLY
    # ================================
    
    async def search_habits(
        self,
        query: str,
        user_id: str,
        limit: int = 10,
        include_inactive: bool = False,
    ) -> List[Dict[str, Any]]:
        """Search habits with autocomplete"""
        if not self.is_available:
            return []
        
        filter_by = f"user_id:={user_id}"
        if not include_inactive:
            filter_by += " && is_active:=true"
        
        try:
            result = self.client.collections["habits"].documents.search({
                "q": query,
                "query_by": "name,name_lowercase,aliases,category",
                "filter_by": filter_by,
                "sort_by": "_text_match:desc,last_logged_at:desc,log_count:desc",
                "per_page": limit,
                "prefix": True,  # Enable prefix search for autocomplete
                "typo_tokens_threshold": 1,
                "highlight_full_fields": "name",
            })
            
            return [
                {
                    "id": hit["document"]["id"],
                    "name": hit["document"]["name"],
                    "category": hit["document"].get("category"),
                    "icon": hit["document"].get("icon"),
                    "unit_type": hit["document"].get("unit_type"),
                    "highlight": hit.get("highlight", {}).get("name", {}).get("snippet"),
                    "score": hit.get("text_match", 0),
                }
                for hit in result.get("hits", [])
            ]
        except Exception as e:
            logger.error(f"❌ Habit search failed: {e}")
            return []
    
    # ================================
    # SEARCH - LOGS
    # ================================
    
    async def search_logs(
        self,
        query: str,
        user_id: str,
        habit_ids: List[str] = None,
        start_date: str = None,
        end_date: str = None,
        limit: int = 50,
    ) -> Dict[str, Any]:
        """Search habit logs with filters"""
        if not self.is_available:
            return {"hits": [], "found": 0}
        
        filter_by = f"user_id:={user_id}"
        
        if habit_ids:
            filter_by += f" && habit_id:[{','.join(habit_ids)}]"
        
        if start_date:
            start_ts = self._date_to_timestamp(start_date)
            filter_by += f" && date_timestamp:>={start_ts}"
        
        if end_date:
            end_ts = self._date_to_timestamp(end_date) + 86400  # Include end date
            filter_by += f" && date_timestamp:<{end_ts}"
        
        try:
            result = self.client.collections["habit_logs"].documents.search({
                "q": query or "*",
                "query_by": "habit_name,notes",
                "filter_by": filter_by,
                "sort_by": "_text_match:desc,date_timestamp:desc" if query else "date_timestamp:desc",
                "per_page": limit,
                "facet_by": "habit_id,category,status,source",
                "typo_tokens_threshold": 1,
            })
            
            return {
                "hits": [hit["document"] for hit in result.get("hits", [])],
                "found": result.get("found", 0),
                "facets": result.get("facet_counts", []),
            }
        except Exception as e:
            logger.error(f"❌ Log search failed: {e}")
            return {"hits": [], "found": 0}
    
    # ================================
    # HELPER METHODS
    # ================================
    
    def _search_quick_actions(self, query: str) -> List[Dict]:
        """Search quick actions by keywords"""
        if not query:
            return QUICK_ACTIONS[:5]
        
        query_lower = query.lower()
        scored_actions = []
        
        for action in QUICK_ACTIONS:
            score = 0
            
            # Check name match
            if query_lower in action["name"].lower():
                score += 10
            
            # Check keyword matches
            for keyword in action.get("keywords", []):
                if query_lower in keyword or keyword in query_lower:
                    score += 5
            
            if score > 0:
                scored_actions.append({**action, "score": score})
        
        # Sort by score and return top results
        scored_actions.sort(key=lambda x: x["score"], reverse=True)
        return scored_actions[:5]
    
    def _format_results(self, result: Dict) -> Dict[str, Any]:
        """Format Typesense results for frontend"""
        if not result:
            return {"hits": [], "found": 0}
        
        return {
            "hits": [
                {
                    **hit["document"],
                    "highlight": hit.get("highlight", {}),
                    "score": hit.get("text_match", 0),
                }
                for hit in result.get("hits", [])
            ],
            "found": result.get("found", 0),
        }
    
    def _get_recent_items(self, user_id: str, limit: int = 10) -> Dict[str, Any]:
        """Get recent items when no query is provided"""
        result = {
            "query": "",
            "quick_actions": QUICK_ACTIONS[:5],
            "habits": {"hits": [], "found": 0},
            "logs": {"hits": [], "found": 0},
            "conversations": {"hits": [], "found": 0},
            "activity": {"hits": [], "found": 0},
        }
        
        if not self.is_available:
            return result
        
        try:
            # Get recent habits
            habits_result = self.client.collections["habits"].documents.search({
                "q": "*",
                "query_by": "name",
                "filter_by": f"user_id:={user_id} && is_active:=true",
                "sort_by": "last_logged_at:desc",
                "per_page": limit,
            })
            result["habits"] = self._format_results(habits_result)
            
            # Get recent logs
            logs_result = self.client.collections["habit_logs"].documents.search({
                "q": "*",
                "query_by": "habit_name",
                "filter_by": f"user_id:={user_id}",
                "sort_by": "date_timestamp:desc",
                "per_page": limit,
            })
            result["logs"] = self._format_results(logs_result)
            
        except Exception as e:
            logger.error(f"❌ Failed to get recent items: {e}")
        
        return result
    
    # ================================
    # SUGGESTIONS - Personalized suggestions for chat input
    # ================================

    # Question templates for chat mode suggestions
    # {habit} is replaced with actual habit names
    CHAT_TEMPLATES_HABIT = [
        "How has my {habit} been this week?",
        "What's my {habit} trend over the past month?",
        "How does my {habit} this week compare to last week?",
        "Am I improving at {habit}?",
        "What's my average daily {habit}?",
        "When do I usually log {habit}?",
        "Show me my {habit} patterns",
        "What's my {habit} streak?",
        "How consistent have I been with {habit}?",
    ]

    CHAT_TEMPLATES_GENERAL = [
        "Which habits am I most consistent with?",
        "What habits have I been slacking on?",
        "What patterns do you see in my data?",
        "How am I doing overall this week?",
        "What should I focus on improving?",
        "Compare my performance this week vs last week",
        "What are my best days for productivity?",
        "Which habits correlate with each other?",
    ]

    async def get_suggestions(
        self,
        user_id: str,
        mode: str = "chat",
        query: str = "",
        habits_context: List[Dict] = None,
    ) -> List[Dict[str, Any]]:
        """
        Generate personalized suggestions for the chat input.
        
        Log mode: habit autocomplete (from Typesense prefix search or recent habits)
        Chat mode: personalized question suggestions based on user's habits
        """
        if mode == "log":
            return await self._get_log_suggestions(user_id, query, habits_context)
        else:
            return await self._get_chat_suggestions(user_id, query, habits_context)

    def _format_value_suggestion(self, value: float, unit_type: str, habit_name: str) -> str:
        """Format a value-based suggestion like '200mg of caffeine' or '15 min meditation'"""
        abbrev = UNIT_ABBREVIATIONS.get(unit_type, unit_type or "")
        
        # Clean up the value display (no trailing .0)
        val_str = str(int(value)) if value == int(value) else f"{value:.1f}"
        
        name_lower = habit_name.lower()
        
        if not abbrev:
            # Count-based: "10 pull-ups"
            return f"{val_str} {name_lower}"
        elif abbrev in ("min", "hr"):
            # Duration: "15 min meditation"
            return f"{val_str} {abbrev} {name_lower}"
        else:
            # Amount with unit: "200mg of caffeine"
            # Check if abbrev should be attached (mg, g, kg) vs separated (pages, steps)
            attached_units = {"mg", "g", "kg", "lbs", "cal", "L", "km", "mi"}
            if abbrev in attached_units:
                return f"{val_str}{abbrev} of {name_lower}"
            else:
                return f"{val_str} {abbrev} of {name_lower}"

    async def _get_habit_common_values(
        self, user_id: str, habit_id: str, limit: int = 20
    ) -> List[float]:
        """
        Get the most common log values for a habit from the habit_logs collection.
        Returns deduplicated values sorted by frequency (most common first).
        """
        if not self.is_available:
            return []
        
        try:
            result = self.client.collections["habit_logs"].documents.search({
                "q": "*",
                "query_by": "habit_name",
                "filter_by": f"user_id:={user_id} && habit_id:={habit_id}",
                "sort_by": "date_timestamp:desc",
                "per_page": limit,
            })
            
            from collections import Counter
            values: List[float] = []
            
            for hit in result.get("hits", []):
                doc = hit["document"]
                amount = doc.get("amount")
                duration = doc.get("duration")
                
                if amount is not None and amount > 0:
                    values.append(float(amount))
                elif duration is not None and duration > 0:
                    # Duration is stored in seconds; convert to the display unit
                    # Prefer minutes for short durations, hours for longer
                    minutes = duration / 60
                    if minutes >= 60 and minutes % 60 == 0:
                        values.append(minutes / 60)  # Store as hours
                    else:
                        values.append(minutes)  # Store as minutes
            
            # Return most common values, deduplicated
            counter = Counter(values)
            return [v for v, _ in counter.most_common(6)]
        
        except Exception as e:
            logger.warning(f"⚠️ Get habit values failed: {e}")
            return []

    async def _get_log_suggestions(
        self, user_id: str, query: str, habits_context: List[Dict] = None
    ) -> List[Dict[str, Any]]:
        """
        Smart log suggestions with two strategies:
        
        1. Phrase matching: Search log_phrases collection for learned input patterns.
           "I consumed" → matches past "I consumed 200mg of caffeine" → Caffeine Consumption.
        2. Habit name matching: Standard Typesense search on habits collection.
        
        Once a habit is identified, get common values and return formatted suggestions
        like "200mg of caffeine", "100mg of caffeine".
        """
        if not self.is_available:
            # Client-side fallback
            if habits_context:
                return [
                    {
                        "text": h.get("name", ""),
                        "type": "habit",
                        "habit_id": h.get("id"),
                        "habit_name": h.get("name", ""),
                        "unit_type": h.get("unit_type"),
                    }
                    for h in habits_context[:4]
                ]
            return []

        # ── User is typing: phrase match + habit name search ──
        if query:
            matched_habit = None  # Will be: {id, name, unit_type}
            
            # Strategy 1: Search log_phrases for learned patterns
            try:
                phrase_result = self.client.collections["log_phrases"].documents.search({
                    "q": query,
                    "query_by": "input_text",
                    "filter_by": f"user_id:={user_id}",
                    "sort_by": "_text_match:desc,created_at:desc",
                    "per_page": 1,
                    "prefix": True,
                    "typo_tokens_threshold": 1,
                })
                
                if phrase_result.get("found", 0) > 0:
                    top_hit = phrase_result["hits"][0]["document"]
                    # Look up the full habit info
                    try:
                        habit_result = self.client.collections["habits"].documents.search({
                            "q": "*",
                            "query_by": "name",
                            "filter_by": f"user_id:={user_id} && id:={top_hit['habit_id']}",
                            "per_page": 1,
                        })
                        if habit_result.get("found", 0) > 0:
                            h = habit_result["hits"][0]["document"]
                            matched_habit = {
                                "id": h["id"],
                                "name": h["name"],
                                "unit_type": h.get("unit_type", ""),
                            }
                    except Exception:
                        matched_habit = {
                            "id": top_hit["habit_id"],
                            "name": top_hit["habit_name"],
                            "unit_type": top_hit.get("unit", ""),
                        }
            except ObjectNotFound:
                pass  # log_phrases collection may not exist yet
            except Exception as e:
                logger.warning(f"⚠️ Log phrase search failed: {e}")
            
            # Strategy 2: Fallback to habit name prefix search
            if not matched_habit:
                try:
                    habit_result = self.client.collections["habits"].documents.search({
                        "q": query,
                        "query_by": "name,name_lowercase,aliases,category",
                        "filter_by": f"user_id:={user_id} && is_active:=true",
                        "sort_by": "_text_match:desc,last_logged_at:desc",
                        "per_page": 1,
                        "prefix": True,
                        "typo_tokens_threshold": 1,
                    })
                    
                    if habit_result.get("found", 0) > 0:
                        h = habit_result["hits"][0]["document"]
                        matched_habit = {
                            "id": h["id"],
                            "name": h["name"],
                            "unit_type": h.get("unit_type", ""),
                        }
                except Exception as e:
                    logger.warning(f"⚠️ Habit name search failed: {e}")
            
            # If we matched a habit, generate value-based suggestions
            if matched_habit:
                common_values = await self._get_habit_common_values(
                    user_id, matched_habit["id"]
                )
                
                if common_values:
                    return [
                        {
                            "text": self._format_value_suggestion(
                                val,
                                matched_habit["unit_type"],
                                matched_habit["name"],
                            ),
                            "type": "log_phrase",
                            "habit_id": matched_habit["id"],
                            "habit_name": matched_habit["name"],
                            "unit_type": matched_habit["unit_type"],
                            "value": val,
                        }
                        for val in common_values[:4]
                    ]
                else:
                    # No log history yet; suggest the habit name
                    return [{
                        "text": matched_habit["name"],
                        "type": "habit",
                        "habit_id": matched_habit["id"],
                        "habit_name": matched_habit["name"],
                        "unit_type": matched_habit["unit_type"],
                    }]
            
            # No match at all: return empty
            return []

        # ── Empty state: recently logged habits with their last value ──
        try:
            result = self.client.collections["habits"].documents.search({
                "q": "*",
                "query_by": "name",
                "filter_by": f"user_id:={user_id} && is_active:=true",
                "sort_by": "last_logged_at:desc",
                "per_page": 4,
            })
            
            suggestions = []
            for hit in result.get("hits", []):
                doc = hit["document"]
                
                # Get the most recent value for this habit
                common_values = await self._get_habit_common_values(
                    user_id, doc["id"], limit=5
                )
                
                if common_values:
                    # Show the most common value
                    text = self._format_value_suggestion(
                        common_values[0],
                        doc.get("unit_type", ""),
                        doc["name"],
                    )
                else:
                    text = doc["name"]
                
                suggestions.append({
                    "text": text,
                    "type": "log_phrase" if common_values else "habit",
                    "habit_id": doc["id"],
                    "habit_name": doc["name"],
                    "unit_type": doc.get("unit_type"),
                    "value": common_values[0] if common_values else None,
                })
            
            if suggestions:
                return suggestions
        
        except Exception as e:
            logger.warning(f"⚠️ Recent habits fetch failed: {e}")

        # Fallback
        if habits_context:
            return [
                {
                    "text": h.get("name", ""),
                    "type": "habit",
                    "habit_id": h.get("id"),
                    "habit_name": h.get("name", ""),
                    "unit_type": h.get("unit_type"),
                }
                for h in habits_context[:4]
            ]
        
        return []

    async def _get_chat_suggestions(
        self, user_id: str, query: str, habits_context: List[Dict] = None
    ) -> List[Dict[str, Any]]:
        """Generate personalized chat question suggestions using the user's habits"""

        # Get user's habits for personalization
        habit_names: List[str] = []

        if self.is_available:
            try:
                result = self.client.collections["habits"].documents.search({
                    "q": "*",
                    "query_by": "name",
                    "filter_by": f"user_id:={user_id} && is_active:=true",
                    "sort_by": "last_logged_at:desc",
                    "per_page": 20,
                })
                habit_names = [
                    hit["document"]["name"]
                    for hit in result.get("hits", [])
                ]
            except Exception as e:
                logger.warning(f"⚠️ Chat suggestions - habits fetch failed: {e}")

        if not habit_names and habits_context:
            habit_names = [h.get("name", "") for h in habits_context if h.get("name")]

        # Build the full suggestion pool
        all_suggestions: List[Dict[str, Any]] = []

        # Add habit-specific suggestions
        for habit_name in habit_names[:8]:
            for template in self.CHAT_TEMPLATES_HABIT:
                text = template.replace("{habit}", habit_name.lower())
                all_suggestions.append({"text": text, "type": "question", "habit_name": habit_name})

        # Add general suggestions
        for template in self.CHAT_TEMPLATES_GENERAL:
            all_suggestions.append({"text": template, "type": "question"})

        # If user is typing, filter by query match
        if query:
            query_lower = query.lower()
            filtered = [
                s for s in all_suggestions
                if query_lower in s["text"].lower()
            ]
            return filtered[:5]

        # Empty state: pick a diverse set using day-of-year rotation
        # This gives consistent suggestions within a day but variety across days
        if habit_names:
            day_seed = datetime.utcnow().timetuple().tm_yday
            suggestions = []
            seen_habits = set()

            # Pick 3 habit-specific suggestions (different habits)
            habit_specific = [s for s in all_suggestions if s.get("habit_name")]
            for i in range(len(habit_specific)):
                idx = (day_seed + i * 7) % len(habit_specific)
                s = habit_specific[idx]
                h = s.get("habit_name", "")
                if h not in seen_habits:
                    suggestions.append(s)
                    seen_habits.add(h)
                if len(suggestions) >= 3:
                    break

            # Pick 1 general suggestion
            general = [s for s in all_suggestions if not s.get("habit_name")]
            if general:
                idx = day_seed % len(general)
                suggestions.append(general[idx])

            return suggestions[:4]
        else:
            # No habits: return general suggestions
            return [{"text": t, "type": "question"} for t in self.CHAT_TEMPLATES_GENERAL[:4]]

    def _fallback_search(self, query: str) -> Dict[str, Any]:
        """Fallback when Typesense is not available"""
        return {
            "query": query,
            "quick_actions": self._search_quick_actions(query),
            "habits": {"hits": [], "found": 0},
            "logs": {"hits": [], "found": 0},
            "conversations": {"hits": [], "found": 0},
            "activity": {"hits": [], "found": 0},
            "fallback": True,
        }
    
    def _to_timestamp(self, value) -> int:
        """Convert various datetime formats to Unix timestamp"""
        if value is None:
            return int(datetime.utcnow().timestamp())
        
        if isinstance(value, (int, float)):
            return int(value)
        
        if isinstance(value, datetime):
            return int(value.timestamp())
        
        if isinstance(value, str):
            try:
                dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
                return int(dt.timestamp())
            except:
                return int(datetime.utcnow().timestamp())
        
        return int(datetime.utcnow().timestamp())
    
    def _date_to_timestamp(self, date_str: str) -> int:
        """Convert YYYY-MM-DD to Unix timestamp (start of day)"""
        if not date_str:
            return 0
        
        try:
            dt = datetime.strptime(date_str[:10], "%Y-%m-%d")
            return int(dt.timestamp())
        except:
            return 0


# Global service instance
search_service = SearchService()
