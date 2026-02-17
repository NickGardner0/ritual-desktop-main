//! Error types for the Ritual database
//!
//! Provides a unified error type that covers all database operations.

use thiserror::Error;

/// Result type alias using DatabaseError
pub type Result<T> = std::result::Result<T, DatabaseError>;

/// Unified error type for database operations
#[derive(Error, Debug)]
pub enum DatabaseError {
    /// Failed to connect to the database
    #[error("Database connection error: {0}")]
    Connection(String),
    
    /// Query execution failed
    #[error("Query error: {0}")]
    Query(String),
    
    /// Migration failed
    #[error("Migration error: {0}")]
    Migration(String),
    
    /// Data not found
    #[error("Not found: {0}")]
    NotFound(String),
    
    /// Invalid data or constraint violation
    #[error("Invalid data: {0}")]
    InvalidData(String),
    
    /// I/O error (file operations)
    #[error("I/O error: {0}")]
    Io(String),
    
    /// Embedding/vector operation error
    #[error("Embedding error: {0}")]
    Embedding(String),
    
    /// Schema error
    #[error("Schema error: {0}")]
    Schema(String),
    
    /// Legacy SQLite error (during migration)
    #[error("Legacy SQLite error: {0}")]
    LegacySqlite(String),
    
    /// Serialization/deserialization error
    #[error("Serialization error: {0}")]
    Serialization(String),
    
    /// Lock/concurrency error
    #[error("Lock error: {0}")]
    Lock(String),
}

impl From<libsql::Error> for DatabaseError {
    fn from(err: libsql::Error) -> Self {
        DatabaseError::Query(err.to_string())
    }
}

impl From<rusqlite::Error> for DatabaseError {
    fn from(err: rusqlite::Error) -> Self {
        DatabaseError::LegacySqlite(err.to_string())
    }
}

impl From<std::io::Error> for DatabaseError {
    fn from(err: std::io::Error) -> Self {
        DatabaseError::Io(err.to_string())
    }
}

impl From<serde_json::Error> for DatabaseError {
    fn from(err: serde_json::Error) -> Self {
        DatabaseError::Serialization(err.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_error_display() {
        let err = DatabaseError::Connection("test error".to_string());
        assert!(err.to_string().contains("test error"));
    }
    
    #[test]
    fn test_error_from_io() {
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "file not found");
        let db_err: DatabaseError = io_err.into();
        assert!(matches!(db_err, DatabaseError::Io(_)));
    }
}
