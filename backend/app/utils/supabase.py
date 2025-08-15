"""
Supabase client configuration
"""

import os
from dotenv import load_dotenv
from supabase import create_client, Client

# Load environment variables
load_dotenv()

# Supabase credentials
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

def get_supabase_client() -> Client:
    """
    Create and return a Supabase client instance
    """
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise ValueError(
            "Supabase URL and API key are required. Please check your environment variables."
        )
    
    return create_client(SUPABASE_URL, SUPABASE_KEY)

def get_supabase_admin_client() -> Client:
    """
    Create and return a Supabase client with service role (admin privileges)
    """
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise ValueError(
            "Supabase URL and service role key are required. Please check your environment variables."
        )
    
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) 