/**
 * Environment Variable Validation
 * 
 * Validates that all required environment variables are set before the app starts.
 * This helps catch configuration errors early in production.
 */

interface RequiredEnvVars {
  [key: string]: string | undefined;
}

interface ValidationResult {
  isValid: boolean;
  missingVars: string[];
  warnings: string[];
}

/**
 * Validate required environment variables
 */
export function validateEnvironment(): ValidationResult {
  const missingVars: string[] = [];
  const warnings: string[] = [];
  
  // Critical environment variables
  const requiredVars: RequiredEnvVars = {
    'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY': process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    'CLERK_SECRET_KEY': process.env.CLERK_SECRET_KEY,
  };
  
  // Highly recommended variables (warnings only)
  const recommendedVars: RequiredEnvVars = {
    'NEXT_PUBLIC_PYTHON_API_URL': process.env.NEXT_PUBLIC_PYTHON_API_URL,
    'TINYBIRD_TOKEN': process.env.TINYBIRD_TOKEN,
    'OPENAI_API_KEY': process.env.OPENAI_API_KEY,
  };
  
  // Check required variables
  for (const [key, value] of Object.entries(requiredVars)) {
    if (!value || value === '') {
      missingVars.push(key);
    }
  }
  
  // Check recommended variables (only in production)
  if (process.env.NODE_ENV === 'production') {
    for (const [key, value] of Object.entries(recommendedVars)) {
      if (!value || value === '') {
        warnings.push(`Recommended environment variable missing: ${key}`);
      }
    }
  }
  
  return {
    isValid: missingVars.length === 0,
    missingVars,
    warnings,
  };
}

/**
 * Validate and throw error if critical variables are missing
 */
export function validateOrThrow(): void {
  const result = validateEnvironment();
  
  if (!result.isValid) {
    const errorMessage = `
❌ Missing required environment variables:
${result.missingVars.map(v => `  - ${v}`).join('\n')}

Please check your .env file and ensure all required variables are set.
See .env.example for a template.
    `.trim();
    
    throw new Error(errorMessage);
  }
  
  // Log warnings
  if (result.warnings.length > 0) {
    console.warn('⚠️  Environment warnings:');
    result.warnings.forEach(warning => console.warn(`  - ${warning}`));
  }
}

/**
 * Check if we're running in production mode
 */
export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * Check if we're running in development mode
 */
export function isDevelopment(): boolean {
  return process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;
}

