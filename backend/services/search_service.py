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
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any, Literal
import typesense
from typesense.exceptions import ObjectNotFound, TypesenseClientError

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
            print("⚠️ TYPESENSE_API_KEY not set - search features disabled")
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
            print(f"✅ Typesense client initialized: {protocol}://{host}:{port}")
        except Exception as e:
            print(f"❌ Failed to initialize Typesense client: {e}")
    
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
        ]
        
        for schema in schemas:
            try:
                self.client.collections[schema["name"]].retrieve()
                print(f"✓ Collection '{schema['name']}' exists")
            except ObjectNotFound:
                try:
                    self.client.collections.create(schema)
                    print(f"✓ Created collection '{schema['name']}'")
                except TypesenseClientError as e:
                    print(f"❌ Failed to create collection '{schema['name']}': {e}")
    
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
            print(f"❌ Failed to index habit {habit.get('id')}: {e}")
    
    async def delete_habit_index(self, habit_id: str):
        """Remove a habit from the index"""
        if not self.is_available:
            return
        
        try:
            self.client.collections["habits"].documents[habit_id].delete()
        except ObjectNotFound:
            pass
        except Exception as e:
            print(f"❌ Failed to delete habit index {habit_id}: {e}")
    
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
            print(f"❌ Failed to index habit log {log.get('id')}: {e}")
    
    async def delete_habit_log_index(self, log_id: str):
        """Remove a log from the index"""
        if not self.is_available:
            return
        
        try:
            self.client.collections["habit_logs"].documents[log_id].delete()
        except ObjectNotFound:
            pass
        except Exception as e:
            print(f"❌ Failed to delete log index {log_id}: {e}")
    
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
            print(f"❌ Failed to index AI message {message.get('id')}: {e}")
    
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
            print(f"❌ Failed to index activity: {e}")
    
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
            print(f"✓ Indexed {len(docs)} habits")
        except Exception as e:
            print(f"❌ Bulk habit indexing failed: {e}")
    
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
            print(f"✓ Indexed {len(docs)} logs")
        except Exception as e:
            print(f"❌ Bulk log indexing failed: {e}")
    
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
            print(f"❌ Search failed: {e}")
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
            print(f"❌ Habit search failed: {e}")
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
            print(f"❌ Log search failed: {e}")
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
            print(f"❌ Failed to get recent items: {e}")
        
        return result
    
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

