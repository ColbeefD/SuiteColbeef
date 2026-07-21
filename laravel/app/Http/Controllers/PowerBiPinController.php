<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;

/**
 * Protección por PIN de los informes de Power BI.
 *
 * El PIN se verifica contra un hash bcrypt del servidor (config('powerbi.pin_hash'))
 * y, si es correcto, se entrega una cookie HttpOnly de "desbloqueo" con TTL
 * configurable. Nota: el PIN protege el acceso DESDE el portal; no impide abrir
 * una URL pública de Power BI copiada por fuera (documentado en config/powerbi.php).
 *
 * @see config/powerbi.php
 */
class PowerBiPinController extends Controller
{
    /** Indica si la cookie de desbloqueo vigente permite abrir Power BI. */
    public function session(Request $request): JsonResponse
    {
        $cookieName = (string) config('powerbi.cookie_name', 'WorkColbeef_powerbi_unlocked');
        $val = (string) $request->cookie($cookieName, '');

        return response()->json([
            'ok' => true,
            'unlocked' => $val === '1',
        ]);
    }

    public function verify(Request $request): JsonResponse
    {
        $pinHash = (string) config('powerbi.pin_hash', '');
        if ($pinHash === '') {
            return response()->json(['ok' => false, 'error' => 'PIN no configurado en servidor.'], 503);
        }

        $key = 'powerbi-pin:'.$request->ip();
        $maxAttempts = 12;
        $decaySeconds = 10 * 60;

        if (RateLimiter::tooManyAttempts($key, $maxAttempts)) {
            $wait = RateLimiter::availableIn($key);

            return response()->json([
                'ok' => false,
                'error' => 'Demasiados intentos. Espera '.max(1, (int) ceil($wait / 60)).' minuto(s).',
            ], 429);
        }

        $pin = trim((string) $request->input('pin', ''));
        if ($pin === '' || Str::length($pin) < 4) {
            return response()->json(['ok' => false, 'error' => 'PIN inválido.'], 400);
        }

        if (!Hash::check($pin, $pinHash)) {
            RateLimiter::hit($key, $decaySeconds);
            return response()->json(['ok' => false, 'error' => 'PIN incorrecto.'], 401);
        }

        RateLimiter::clear($key);

        $cookieName = (string) config('powerbi.cookie_name', 'WorkColbeef_powerbi_unlocked');
        $ttl = (int) config('powerbi.ttl_minutes', 120);

        $cookie = cookie(
            $cookieName,
            '1',
            $ttl,
            '/',
            null,
            $request->secure(),
            true,
            false,
            'lax'
        );

        return response()->json(['ok' => true, 'unlocked' => true])->withCookie($cookie);
    }
}

