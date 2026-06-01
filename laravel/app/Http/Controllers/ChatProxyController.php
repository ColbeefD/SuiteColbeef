<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;

class ChatProxyController extends Controller
{
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

        $systemPrompt = 'Eres el asistente virtual del sistema Workbeef. Respondes de forma breve, amable y profesional. '
            .'Ayudas a los usuarios a navegar por el sistema. Conoces módulos principales: '
            .'1) CONTROL OPERATIVO (incluye: ingreso de vehículos, plan de faena, pesaje, corrales, '
            .'insensibilización, rendimientos, facturas, ranking de clientes). '
            .'2) GESTIÓN HUMANA (incluye: app principal en http://192.168.20.205:5000/login; módulo Contratista en '
            .'http://192.168.20.205:8009/login — acceso desde la tarjeta Gestión humana en Workbeef; personal activo, '
            .'perfiles por área, eventos como cumpleaños, solicitudes de permisos y vacaciones, datos de beneficios '
            .'como EPS y pensiones, y panel de gráficos). '
            .'3) LOGÍSTICA (incluye: módulo de Desposte en http://192.168.20.205:8004/login — ahí se gestiona el desposte; '
            .'inventarios en http://192.168.20.205:8501/; ERP logístico en http://192.168.20.205:8088/login.php; '
            .'lenguas en http://192.168.20.205:8005/; ingresar lenguas a inventario y generar documentación operativa). '
            .'4) CANALES (incluye: registro de hallazgos y tolerancia, historial de registros, animales procesados, '
            .'dashboards diarios y mensuales con resumen gráfico, asignación de operación, asignación de puestos de trabajo '
            .'que puede cambiar cada día, gestión de usuarios, seguimiento de tiempo de uso o usabilidad). '
            .'5) LOCKERBEEF (incluye: migración del control basado en hojas de cálculo a un aplicativo web integral para la '
            .'gestión de recursos físicos, operando sobre una base de datos robusta y centralizada). '
            .'Si te preguntan algo fuera de este sistema, indica amablemente que solo puedes ayudar con la plataforma Workbeef.';

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

