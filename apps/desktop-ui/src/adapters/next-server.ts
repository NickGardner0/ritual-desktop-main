export class NextRequest extends Request {}

export class NextResponse extends Response {
  static json(body: unknown, init?: ResponseInit) {
    return new NextResponse(JSON.stringify(body), {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
    });
  }

  static redirect(url: string | URL, status = 307) {
    return new NextResponse(null, {
      status,
      headers: { Location: String(url) },
    });
  }

  static next() {
    return new NextResponse(null, { status: 200 });
  }
}

export function after(task: () => unknown) {
  void task();
}

export function connection() {
  return Promise.resolve();
}
