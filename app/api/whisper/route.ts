import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const audioFile = formData.get('file') as File;
    
    if (!audioFile) {
      return NextResponse.json({ error: 'No audio file provided' }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error('❌ OPENAI_API_KEY environment variable not found');
      return NextResponse.json({ error: 'API key not configured' }, { status: 500 });
    }

    // Forward the request to OpenAI Whisper API
    const openaiFormData = new FormData();
    openaiFormData.append('file', audioFile);
    openaiFormData.append('model', 'whisper-1');

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
      body: openaiFormData,
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('OpenAI Whisper API error:', error);
      return NextResponse.json({ error: 'Failed to transcribe audio' }, { status: response.status });
    }

    const result = await response.json();
    return NextResponse.json({ text: result.text });
    
  } catch (error) {
    console.error('Error in whisper API route:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
