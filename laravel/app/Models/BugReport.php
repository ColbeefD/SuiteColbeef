<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class BugReport extends Model
{
    protected $fillable = [
        'ticket_code',
        'requester_name',
        'requester_email',
        'software',
        'tema',
        'detalle',
        'mensaje',
        'status',
        'visitor_hash',
        'resolved_at',
    ];

    protected function casts(): array
    {
        return [
            'resolved_at' => 'datetime',
        ];
    }
}
