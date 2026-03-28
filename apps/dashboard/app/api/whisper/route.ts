import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { logger } from '@/lib/logger';

export async function POST(req: NextRequest) {
  try {
    // Require authentication
    const { userId } = await auth();
    
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const formData = await req.formData();
    const audioFile = formData.get('file') as File;
    
    if (!audioFile) {
      return NextResponse.json({ error: 'No audio file provided' }, { status: 400 });
    }

    // Try Groq first (super fast!), fallback to OpenAI if not configured
    const groqApiKey = process.env.GROQ_API_KEY;
    const openaiApiKey = process.env.OPENAI_API_KEY;
    
    // Don't log API key presence in production
    logger.info('🔍 Checking API keys...');
    logger.info(`  GROQ_API_KEY: ${groqApiKey ? '✅ Found' : '❌ Not found'}`);
    logger.info(`  OPENAI_API_KEY: ${openaiApiKey ? '✅ Found' : '❌ Not found'}`);
    
    if (!groqApiKey && !openaiApiKey) {
      logger.error('❌ Neither GROQ_API_KEY nor OPENAI_API_KEY found');
      return NextResponse.json({ error: 'API key not configured' }, { status: 500 });
    }

    // Prepare form data for API request
    const apiFormData = new FormData();
    apiFormData.append('file', audioFile);
    
    let apiUrl: string;
    let apiKey: string;
    let modelName: string;

    if (groqApiKey) {
      // Use Groq Whisper (10-20x faster!)
      apiUrl = 'https://api.groq.com/openai/v1/audio/transcriptions';
      apiKey = groqApiKey;
      modelName = 'whisper-large-v3'; // Groq's fastest Whisper model
      logger.info('🚀 Using Groq Whisper for transcription');
    } else {
      // Fallback to OpenAI Whisper
      apiUrl = 'https://api.openai.com/v1/audio/transcriptions';
      apiKey = openaiApiKey!;
      modelName = 'whisper-1';
      logger.info('🔄 Using OpenAI Whisper for transcription');
    }

    apiFormData.append('model', modelName);

    const startTime = Date.now();
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
      body: apiFormData,
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error('❌ Whisper API error:', error);
      return NextResponse.json({ error: 'Failed to transcribe audio' }, { status: response.status });
    }

    const result = await response.json();
    const duration = Date.now() - startTime;
    logger.info(`✅ Transcription completed in ${duration}ms`);
    
    return NextResponse.json({ text: result.text });
    
  } catch (error) {
    logger.error('Error in whisper API route:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
