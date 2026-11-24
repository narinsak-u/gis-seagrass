import { proxyApiRequest } from "@/src/lib/api-proxy";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ path: string[] }>;
}

async function handle(request: Request, context: RouteContext): Promise<Response> {
  const { path } = await context.params;
  return proxyApiRequest(request, path);
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  return handle(request, context);
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return handle(request, context);
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  return handle(request, context);
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  return handle(request, context);
}
