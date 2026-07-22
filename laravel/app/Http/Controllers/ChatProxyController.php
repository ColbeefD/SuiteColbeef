<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;

/**
 * Proxy del asistente virtual "Beef" hacia la API de Google Gemini.
 *
 * Motivo de existir: la GEMINI_API_KEY nunca debe llegar al navegador. El
 * frontend llama a /api/chat y este controlador reenvía la conversación a
 * Gemini adjuntando la clave del servidor, devolviendo la respuesta al cliente.
 *
 * @see config/services (GEMINI_API_KEY, GEMINI_MODEL)
 */
class ChatProxyController extends Controller
{
    /**
     * Reenvía el mensaje del usuario a Gemini con el prompt de sistema y
     * devuelve la respuesta. Responde 503 si falta GEMINI_API_KEY.
     */
    public function chat(Request $request): JsonResponse
    {
        $geminiApiKey = (string) env('GEMINI_API_KEY', '');
        $geminiModel = (string) env('GEMINI_MODEL', 'gemini-2.5-flash');

        if ($geminiApiKey === '') {
            return response()->json([
                'ok' => false,
                'error' => 'GEMINI_API_KEY no está definida en .env',
            ], 503);
        }

        $contents = $request->input('contents');
        if (!is_array($contents)) {
            return response()->json([
                'ok' => false,
                'error' => 'Se esperaba un array "contents".',
            ], 400);
        }

        $systemPrompt = 'Eres el asistente virtual del sistema WorkColbeef. Respondes de forma breve, amable y profesional. '
            .'Ayudas a los usuarios a navegar por el sistema. Conoces módulos principales: '
            .'1) CONTROL OPERATIVO (incluye: ingreso de vehículos, plan de faena, pesaje, corrales, '
            .'insensibilización, rendimientos, facturas, ranking de clientes). '
            .'2) GESTIÓN HUMANA (incluye: app principal en http://192.168.20.205:5000/login; módulo Contratista en '
            .'http://192.168.20.205:8009/login — acceso desde la tarjeta Gestión humana en WorkColbeef; personal activo, '
            .'perfiles por área, eventos como cumpleaños, solicitudes de permisos y vacaciones, datos de beneficios '
            .'como EPS y pensiones, y panel de gráficos). '
            .'3) LOGÍSTICA (incluye: módulo de Desposte en http://192.168.20.205:8004/login — ahí se gestiona el desposte; '
            .'inventarios en http://192.168.20.205:8501/; ERP logístico en http://192.168.20.205:8088/login.php; '
            .'lenguas en http://192.168.20.205:8005/; ingresar lenguas a inventario y generar documentación operativa). '
            .'4) CALIDAD (incluye: Canales en http://192.168.20.205:8006/login; '
            .'Colbeef-Ops en http://192.168.20.205:8081 — acceso desde la tarjeta Calidad en WorkColbeef, botones Canales y Colbeef-Ops; hallazgos, tolerancia, registros, '
            .'dashboards y controles de calidad en planta). '
            .'5) TESORERÍA Y CARTERA (incluye: Pago proveedores en http://192.168.20.205:8100/ — acceso desde la tarjeta '
            .'Tesorería y cartera en WorkColbeef, botón Pago proveedores). '
            .'6) LOCKERBEEF (incluye: migración del control basado en hojas de cálculo a un aplicativo web integral para la '
            .'gestión de recursos físicos, operando sobre una base de datos robusta y centralizada). '
            .'Si te preguntan algo fuera de este sistema, indica amablemente que solo puedes ayudar con la plataforma WorkColbeef.';

        $url = 'https://generativelanguage.googleapis.com/v1beta/models/'
            .urlencode($geminiModel)
            .':generateContent?key='
            .urlencode($geminiApiKey);

        $res = Http::timeout(40)->post($url, [
            'systemInstruction' => [
                'parts' => [['text' => $systemPrompt]],
            ],
            'contents' => $contents,
        ]);

        return response()->json($res->json(), $res->status());
    }
}

