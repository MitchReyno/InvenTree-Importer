export interface BatchCreate {
  title: string;
  note: string;
}

export interface LotCreate {
  expected_batch_revision: string;
  label: string;
  note: string;
  part_subject_id: string | null;
}

export interface PartSelection {
  expected_revision: string;
  choice: {
    target_context_id: string;
    model: "part";
    pk: string;
    observation_id: string;
  };
}

export interface LotSelection {
  expected_revision: string;
  quantity?:
    | {
        mode: "inherit";
      }
    | {
        mode: "clear";
      }
    | {
        mode: "set";
        value: string;
      };
  location?:
    | {
        mode: "inherit";
      }
    | {
        mode: "clear";
      }
    | {
        mode: "set";
        value: {
          target_context_id: string;
          model: "location";
          pk: string;
          observation_id: string;
        };
      };
}

export interface Preparation {
  expected_batch_revision: string;
  /**
   * @minItems 1
   * @maxItems 100
   */
  selected_lot_ids: [string, ...string[]];
}

export interface Approval {
  preparation_id: string;
  expected_plan_sha256: string;
  expected_review_fingerprint: string;
  /**
   * @minItems 1
   * @maxItems 100
   */
  selected_lot_ids: [string, ...string[]];
  expected_target_revision: string;
}

export interface Cancellation {
  expected_run_revision: string;
}

export interface RunSnapshot {
  run_id: string;
  revision: string;
  state: "queued" | "running" | "stopping" | "settled_complete" | "settled_incomplete" | "recovery_required";
  effect_certainty: "none" | "confirmed" | "unknown" | "mixed";
  confirmed_stock_ids: string[];
  cursor: {
    stream_id: string;
    sequence: string;
  };
}

export type WorkerEnvelope =
  | {
      schema_version: "bench-intake-worker/1";
      command_id: string;
      attempt_id: string;
      input_sha256: string;
      handler_version: string;
      sequence: string;
      kind: "progress";
      payload: {
        state: "running";
      };
    }
  | {
      schema_version: "bench-intake-worker/1";
      command_id: string;
      attempt_id: string;
      input_sha256: string;
      handler_version: string;
      sequence: string;
      kind: "terminal";
      payload: {
        state: "interrupted" | "completed";
      };
    };

export interface ErrorDto {
  code: string;
  message: string;
  recovery: "refresh" | "wait" | "review" | "none";
  correlation_id: string;
}

export interface Bootstrap {
  mode: "development-key";
  banner: "Single-operator development mode — not a verified human session";
  status: "configured" | "setup_required";
  actor_id: string;
  target_id: string;
  target_context_id: string;
  mutation_enabled: false;
  permission_gate: "deferred_T11";
  csrf_token: string | null;
}

export interface Health {
  status: "ok";
  api_version: "bench-intake-app/1";
}
