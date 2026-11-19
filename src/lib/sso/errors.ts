import { NextResponse } from "next/server";

/** 统一错误结构：{"detail":{"code":"机器码","message":"可操作的中文说明"}} */
export class SsoError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "SsoError";
  }

  toResponse(): NextResponse {
    return NextResponse.json(
      { detail: { code: this.code, message: this.message } },
      { status: this.status, headers: { "Cache-Control": "no-store" } }
    );
  }
}

export function fail(status: number, code: string, message: string): never {
  throw new SsoError(status, code, message);
}

/** 业务 API 的 catch 兜底：先识别 SSO 合同错误，再回落原有 500 行为 */
export function handleApiError(error: unknown, fallbackMessage: string): NextResponse {
  if (error instanceof SsoError) return error.toResponse();
  console.error(fallbackMessage, error);
  return NextResponse.json({ error: fallbackMessage }, { status: 500 });
}
