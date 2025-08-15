export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          email: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          email: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          email?: string
          created_at?: string
          updated_at?: string
        }
      }
      predefined_habits: {
        Row: {
          id: string
          name: string
          type: 'good' | 'bad'
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          type: 'good' | 'bad'
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          type?: 'good' | 'bad'
          created_at?: string
        }
      }
      habits: {
        Row: {
          id: string
          user_id: string
          name: string
          type: 'good' | 'bad'
          is_custom: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          name: string
          type: 'good' | 'bad'
          is_custom?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          name?: string
          type?: 'good' | 'bad'
          is_custom?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      habit_logs: {
        Row: {
          id: string
          habit_id: string
          user_id: string
          date: string
          status: 'completed' | 'skipped' | 'failed'
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          habit_id: string
          user_id: string
          date: string
          status: 'completed' | 'skipped' | 'failed'
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          habit_id?: string
          user_id?: string
          date?: string
          status?: 'completed' | 'skipped' | 'failed'
          created_at?: string
          updated_at?: string
        }
      }
    }
    Enums: {
      habit_type: 'good' | 'bad'
      habit_status: 'completed' | 'skipped' | 'failed'
    }
  }
} 