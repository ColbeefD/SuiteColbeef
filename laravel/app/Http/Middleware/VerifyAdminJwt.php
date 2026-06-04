<?php

namespace App\Http\Middleware;

use Closure;
use Firebase\JWT\JWT;
use Firebase\JWT\Key;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class VerifyAdminJwt
{
    public function handle(Request $request, Closure $next): Response
    {
        $cookieName = (string) config('admin.cookie_name', 'Worldbeef_admin_token');
        $jwt = $request->cookie($cookieName);

        if (!$jwt) {
            return $this->unauthorized($request);
        }

        try {
            $payload = (array) JWT::decode(
                $jwt,
                new Key((string) config('admin.jwt_secret'), 'HS256')
            );

            if (($payload['scope'] ?? null) !== 'admin') {
                return $this->unauthorized($request);
            }
        } catch (\Throwable $e) {
            return $this->unauthorized($request);
        }

        return $next($request);
    }

    private function unauthorized(Request $request): Response
    {
        if ($request->expectsJson() || str_starts_with($request->path(), 'api/')) {
            return response()->json(['ok' => false, 'error' => 'No autorizado'], 401);
        }

        return redirect('/');
    }
}

