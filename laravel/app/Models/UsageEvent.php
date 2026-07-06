<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class UsageEvent extends Model
{
    public $timestamps = false;

    protected $fillable = [
        'event',
        'app_id',
        'program_id',
        'program_label',
        'visitor_hash',
        'user_label',
        'created_at',
    ];

    protected function casts(): array
    {
        return [
            'created_at' => 'datetime',
        ];
    }
}
