<?php

namespace App\Http\Controllers;

use Firebase\JWT\JWT;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;

/**
 * Autenticación del panel de administración.
 *
 * Flujo: el usuario envía la contraseña maestra → se verifica contra el hash
 * bcrypt (config('admin.password_hash'), resuelto desde MASTER_PASSWORD_HASH_B64)
 * → se emite un JWT firmado (firebase/php-jwt) con scope "admin" y se entrega en
 * una cookie HttpOnly. El middleware VerifyAdminJwt valida esa cookie después.
 *
 * Protecciones: rate limiting por IP (RateLimiter) y respuesta 503 si la
 * autenticación no está configurada en el entorno.
 *
 * @see \App\Http\Middleware\VerifyAdminJwt
 * @see config/admin.php
 */
class AdminAuthController extends Controller
{
    /**
     * Verifica la contraseña maestra y, si es correcta, emite la cookie JWT admin.
     * Responde 401 (credenciales), 429 (rate limit) o 503 (sin configurar).
     */
    public function login(Request $request): JsonResponse
    {
        if (!$this->isConfigured()) {
            return response()->json(['ok' => false, 'error' => 'Auth admin no configurada.'], 503);
        }

        $key = 'admin-login:'.$request->ip();
        $maxAttempts = 30;
        $decaySeconds = 5 * 60;

        if (RateLimiter::tooManyAttempts($key, $maxAttempts)) {
            $wait = RateLimiter::availableIn($key);

            return response()->json([
                'ok' => false,
                'error' => 'Demasiados intentos fallidos. Espera '.max(1, (int) ceil($wait / 60)).' minuto(s). (En el servidor: php artisan cache:clear)',
            ], 429);
        }

        $password = trim((string) $request->input('password', ''));
        if ($password === '' || Str::length($password) < 6) {
            return response()->json(['ok' => false, 'error' => 'Contraseña inválida (mínimo 6 caracteres).'], 400);
        }

        $hash = (string) config('admin.password_hash');
        if (!Hash::check($password, $hash)) {
            RateLimiter::hit($key, $decaySeconds);

            return response()->json(['ok' => false, 'error' => 'Contraseña incorrecta.'], 401);
        }

        RateLimiter::clear($key);
        $token = $this->makeJwt();
        // Secure solo con HTTPS; si no, la cookie no se guarda en http://IP (red local).
        $cookie = cookie(
            (string) config('admin.cookie_name'),
            $token,
            (int) config('admin.jwt_ttl_minutes', 480),
            '/',
            null,
            $request->secure(),
            true,
            false,
            'lax'
        );

        return response()->json(['ok' => true])->withCookie($cookie);
    }

    public function session(Request $request): JsonResponse
    {
        if (!$this->isConfigured()) {
            return response()->json(['ok' => false, 'error' => 'Auth admin no configurada.'], 503);
        }

        $jwt = (string) $request->cookie((string) config('admin.cookie_name'), '');
        if ($jwt === '') {
            return response()->json(['ok' => true, 'authenticated' => false]);
        }

        try {
            JWT::decode($jwt, new \Firebase\JWT\Key((string) config('admin.jwt_secret'), 'HS256'));
            return response()->json(['ok' => true, 'authenticated' => true]);
        } catch (\Throwable $e) {
            return response()->json(['ok' => true, 'authenticated' => false]);
        }
    }

    public function logout(): JsonResponse
    {
        $cookie = cookie()->forget((string) config('admin.cookie_name'), '/', null);
        return response()->json(['ok' => true])->withCookie($cookie);
    }

    private function isConfigured(): bool
    {
        return (string) config('admin.password_hash') !== '' && (string) config('admin.jwt_secret') !== '';
    }

    private function makeJwt(): string
    {
        $now = time();
        $ttlMinutes = (int) config('admin.jwt_ttl_minutes', 480);
        $payload = [
            'iss' => config('app.url'),
            'iat' => $now,
            'nbf' => $now,
            'exp' => $now + ($ttlMinutes * 60),
            'scope' => 'admin',
        ];

        return JWT::encode($payload, (string) config('admin.jwt_secret'), 'HS256');
    }
}

