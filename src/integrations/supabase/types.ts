export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      activations: {
        Row: {
          activated_at: string
          device_name: string | null
          id: string
          last_seen_at: string
          license_id: string
          machine_fingerprint: string
          revoked: boolean
          revoked_at: string | null
          session_token_hash: string
        }
        Insert: {
          activated_at?: string
          device_name?: string | null
          id?: string
          last_seen_at?: string
          license_id: string
          machine_fingerprint: string
          revoked?: boolean
          revoked_at?: string | null
          session_token_hash: string
        }
        Update: {
          activated_at?: string
          device_name?: string | null
          id?: string
          last_seen_at?: string
          license_id?: string
          machine_fingerprint?: string
          revoked?: boolean
          revoked_at?: string | null
          session_token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "activations_license_id_fkey"
            columns: ["license_id"]
            isOneToOne: false
            referencedRelation: "licenses"
            referencedColumns: ["id"]
          },
        ]
      }
      app_bundles: {
        Row: {
          created_at: string
          encrypted_blob: string
          id: string
          is_current: boolean
          min_shell_version: string
          notes: string | null
          signature: string
          size_bytes: number | null
          version: string
        }
        Insert: {
          created_at?: string
          encrypted_blob: string
          id?: string
          is_current?: boolean
          min_shell_version?: string
          notes?: string | null
          signature: string
          size_bytes?: number | null
          version: string
        }
        Update: {
          created_at?: string
          encrypted_blob?: string
          id?: string
          is_current?: boolean
          min_shell_version?: string
          notes?: string | null
          signature?: string
          size_bytes?: number | null
          version?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          after_data: Json | null
          before_data: Json | null
          created_at: string
          id: number
          record_id: string | null
          table_name: string
          user_email: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          after_data?: Json | null
          before_data?: Json | null
          created_at?: string
          id?: number
          record_id?: string | null
          table_name: string
          user_email?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          after_data?: Json | null
          before_data?: Json | null
          created_at?: string
          id?: number
          record_id?: string | null
          table_name?: string
          user_email?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      erp_backups: {
        Row: {
          activation_id: string
          created_at: string
          id: string
          payload: Json
        }
        Insert: {
          activation_id: string
          created_at?: string
          id?: string
          payload: Json
        }
        Update: {
          activation_id?: string
          created_at?: string
          id?: string
          payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "erp_backups_activation_id_fkey"
            columns: ["activation_id"]
            isOneToOne: false
            referencedRelation: "activations"
            referencedColumns: ["id"]
          },
        ]
      }
      heartbeats: {
        Row: {
          activation_id: string
          created_at: string
          id: string
          ip_hash: string | null
          user_agent: string | null
        }
        Insert: {
          activation_id: string
          created_at?: string
          id?: string
          ip_hash?: string | null
          user_agent?: string | null
        }
        Update: {
          activation_id?: string
          created_at?: string
          id?: string
          ip_hash?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "heartbeats_activation_id_fkey"
            columns: ["activation_id"]
            isOneToOne: false
            referencedRelation: "activations"
            referencedColumns: ["id"]
          },
        ]
      }
      items: {
        Row: {
          active: boolean
          barcode: string | null
          category: string | null
          cbm_per_carton: number
          code: string
          created_at: string
          created_by: string | null
          id: string
          last_cost: number
          name: string
          units: Json
          updated_at: string
        }
        Insert: {
          active?: boolean
          barcode?: string | null
          category?: string | null
          cbm_per_carton?: number
          code: string
          created_at?: string
          created_by?: string | null
          id?: string
          last_cost?: number
          name: string
          units?: Json
          updated_at?: string
        }
        Update: {
          active?: boolean
          barcode?: string | null
          category?: string | null
          cbm_per_carton?: number
          code?: string
          created_at?: string
          created_by?: string | null
          id?: string
          last_cost?: number
          name?: string
          units?: Json
          updated_at?: string
        }
        Relationships: []
      }
      licenses: {
        Row: {
          active: boolean
          code: string
          created_at: string
          created_by: string | null
          customer_name: string | null
          expires_at: string | null
          id: string
          license_type: string
          max_devices: number
          notes: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          created_by?: string | null
          customer_name?: string | null
          expires_at?: string | null
          id?: string
          license_type: string
          max_devices?: number
          notes?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          created_by?: string | null
          customer_name?: string | null
          expires_at?: string | null
          id?: string
          license_type?: string
          max_devices?: number
          notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      po_expenses: {
        Row: {
          amount: number
          created_at: string
          currency: string
          expense_type: string | null
          id: string
          line_no: number
          note: string | null
          po_id: string
          rate: number
        }
        Insert: {
          amount?: number
          created_at?: string
          currency?: string
          expense_type?: string | null
          id?: string
          line_no: number
          note?: string | null
          po_id: string
          rate?: number
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          expense_type?: string | null
          id?: string
          line_no?: number
          note?: string | null
          po_id?: string
          rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "po_expenses_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      po_rows: {
        Row: {
          cbm: number
          created_at: string
          id: string
          line_no: number
          model: string | null
          name: string | null
          pack: number
          po_id: string
          price: number
          qty: number
          unit: string | null
        }
        Insert: {
          cbm?: number
          created_at?: string
          id?: string
          line_no: number
          model?: string | null
          name?: string | null
          pack?: number
          po_id: string
          price?: number
          qty?: number
          unit?: string | null
        }
        Update: {
          cbm?: number
          created_at?: string
          id?: string
          line_no?: number
          model?: string | null
          name?: string | null
          pack?: number
          po_id?: string
          price?: number
          qty?: number
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "po_rows_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string | null
          id: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name?: string | null
          id: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
        }
        Relationships: []
      }
      purchase_orders: {
        Row: {
          approved: boolean
          approved_at: string | null
          approved_by: string | null
          container_no: string | null
          container_size: string | null
          created_at: string
          created_by: string | null
          currency: string
          distribution_type: string
          id: string
          invoice_no: string | null
          notes: string | null
          number: string
          po_date: string
          rate: number
          supplier_id: string | null
          updated_at: string
        }
        Insert: {
          approved?: boolean
          approved_at?: string | null
          approved_by?: string | null
          container_no?: string | null
          container_size?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          distribution_type?: string
          id?: string
          invoice_no?: string | null
          notes?: string | null
          number: string
          po_date?: string
          rate?: number
          supplier_id?: string | null
          updated_at?: string
        }
        Update: {
          approved?: boolean
          approved_at?: string | null
          approved_by?: string | null
          container_no?: string | null
          container_size?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          distribution_type?: string
          id?: string
          invoice_no?: string | null
          notes?: string | null
          number?: string
          po_date?: string
          rate?: number
          supplier_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          active: boolean
          city: string | null
          code: string
          country: string | null
          created_at: string
          created_by: string | null
          currency: string
          email: string | null
          id: string
          name: string
          notes: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          city?: string | null
          code: string
          country?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          city?: string | null
          code?: string
          country?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_user_role: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user" | "viewer"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user", "viewer"],
    },
  },
} as const
