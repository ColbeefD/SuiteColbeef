<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('usage_events', function (Blueprint $table) {
            if (! Schema::hasColumn('usage_events', 'program_id')) {
                $table->string('program_id', 160)->nullable()->after('app_id');
            }
            if (! Schema::hasColumn('usage_events', 'program_label')) {
                $table->string('program_label', 160)->nullable()->after('program_id');
            }
            if (! Schema::hasColumn('usage_events', 'user_label')) {
                $table->string('user_label', 160)->nullable()->after('visitor_hash');
            }
        });

        Schema::table('usage_events', function (Blueprint $table) {
            $table->index(['program_id', 'created_at'], 'usage_events_program_created_idx');
            $table->index(['user_label', 'created_at'], 'usage_events_user_created_idx');
        });
    }

    public function down(): void
    {
        Schema::table('usage_events', function (Blueprint $table) {
            $table->dropIndex('usage_events_program_created_idx');
            $table->dropIndex('usage_events_user_created_idx');
        });

        Schema::table('usage_events', function (Blueprint $table) {
            if (Schema::hasColumn('usage_events', 'program_label')) {
                $table->dropColumn('program_label');
            }
            if (Schema::hasColumn('usage_events', 'program_id')) {
                $table->dropColumn('program_id');
            }
            if (Schema::hasColumn('usage_events', 'user_label')) {
                $table->dropColumn('user_label');
            }
        });
    }
};
