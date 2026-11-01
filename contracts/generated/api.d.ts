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

export interface CaptureRef {
  observation_id: string;
  target_context_id: string;
  model: "part" | "location";
  pk: string;
}

export type CaptureQuantity =
  | {
      mode: "unset";
    }
  | {
      mode: "unknown";
    }
  | {
      mode: "clear";
    }
  | {
      mode: "set";
      value: string;
    }
  | {
      mode: "inherit";
    };

export type CaptureLocation =
  | {
      mode: "unset";
    }
  | {
      mode: "unknown";
    }
  | {
      mode: "clear";
    }
  | {
      mode: "set";
      value: {
        observation_id: string;
        target_context_id: string;
        model: "part" | "location";
        pk: string;
      };
    }
  | {
      mode: "inherit";
    };

export type CapturePartChoice =
  | {
      mode: "unset";
    }
  | {
      mode: "unknown";
    }
  | {
      mode: "clear";
    }
  | {
      mode: "set";
      value: {
        observation_id: string;
        target_context_id: string;
        model: "part" | "location";
        pk: string;
      };
    };

export interface CaptureDefaults {
  quantity:
    | {
        mode: "unset";
      }
    | {
        mode: "unknown";
      }
    | {
        mode: "clear";
      }
    | {
        mode: "set";
        value: string;
      }
    | {
        mode: "inherit";
      };
  location:
    | {
        mode: "unset";
      }
    | {
        mode: "unknown";
      }
    | {
        mode: "clear";
      }
    | {
        mode: "set";
        value: {
          observation_id: string;
          target_context_id: string;
          model: "part" | "location";
          pk: string;
        };
      }
    | {
        mode: "inherit";
      };
}

export interface CaptureEdit {
  expected_revision: string;
  change:
    | {
        kind: "batch";
        title?: string;
        archived?: boolean;
      }
    | {
        kind: "defaults";
        quantity?:
          | {
              mode: "unset";
            }
          | {
              mode: "unknown";
            }
          | {
              mode: "clear";
            }
          | {
              mode: "set";
              value: string;
            }
          | {
              mode: "inherit";
            };
        location?:
          | {
              mode: "unset";
            }
          | {
              mode: "unknown";
            }
          | {
              mode: "clear";
            }
          | {
              mode: "set";
              value: {
                observation_id: string;
                target_context_id: string;
                model: "part" | "location";
                pk: string;
              };
            }
          | {
              mode: "inherit";
            };
      }
    | {
        kind: "add_part";
        label: string;
      }
    | {
        kind: "add_lot";
        label: string;
        note: string;
        part_subject_id: string | null;
      }
    | {
        kind: "lot";
        id: string;
        label?: string;
        part_subject_id?: string | null;
        quantity?:
          | {
              mode: "unset";
            }
          | {
              mode: "unknown";
            }
          | {
              mode: "clear";
            }
          | {
              mode: "set";
              value: string;
            }
          | {
              mode: "inherit";
            };
        location?:
          | {
              mode: "unset";
            }
          | {
              mode: "unknown";
            }
          | {
              mode: "clear";
            }
          | {
              mode: "set";
              value: {
                observation_id: string;
                target_context_id: string;
                model: "part" | "location";
                pk: string;
              };
            }
          | {
              mode: "inherit";
            };
      }
    | {
        kind: "part";
        id: string;
        label?: string;
        choice?:
          | {
              mode: "unset";
            }
          | {
              mode: "unknown";
            }
          | {
              mode: "clear";
            }
          | {
              mode: "set";
              value: {
                observation_id: string;
                target_context_id: string;
                model: "part" | "location";
                pk: string;
              };
            };
      }
    | {
        kind: "note";
        subject_id: string | null;
        text: string;
      };
}

export interface CaptureObserve {
  model: "part" | "location";
  pk: string;
}

export interface CaptureObservation {
  id: string;
  model: "part" | "location";
  pk: string;
  target_context_id: string;
  label: string;
  observed_at: string;
}

export interface CaptureSummary {
  id: string;
  source_id: string;
  title: string;
  revision: string;
  archived: boolean;
  updated_at: string;
}

export interface CaptureList {
  batches: {
    id: string;
    source_id: string;
    title: string;
    revision: string;
    archived: boolean;
    updated_at: string;
  }[];
  truncated: boolean;
}

export interface CaptureSnapshot {
  id: string;
  source_id: string;
  title: string;
  revision: string;
  archived: boolean;
  updated_at: string;
  actor_id: string;
  target_context_id: string;
  defaults: {
    quantity:
      | {
          mode: "unset";
        }
      | {
          mode: "unknown";
        }
      | {
          mode: "clear";
        }
      | {
          mode: "set";
          value: string;
        }
      | {
          mode: "inherit";
        };
    location:
      | {
          mode: "unset";
        }
      | {
          mode: "unknown";
        }
      | {
          mode: "clear";
        }
      | {
          mode: "set";
          value: {
            observation_id: string;
            target_context_id: string;
            model: "part" | "location";
            pk: string;
          };
        }
      | {
          mode: "inherit";
        };
  };
  parts: {
    id: string;
    label: string;
    revision: string;
    choice:
      | {
          mode: "unset";
        }
      | {
          mode: "unknown";
        }
      | {
          mode: "clear";
        }
      | {
          mode: "set";
          value: {
            observation_id: string;
            target_context_id: string;
            model: "part" | "location";
            pk: string;
          };
        };
  }[];
  lots: {
    id: string;
    label: string;
    revision: string;
    contribution_key: string;
    part_subject_id: string | null;
    quantity:
      | {
          mode: "unset";
        }
      | {
          mode: "unknown";
        }
      | {
          mode: "clear";
        }
      | {
          mode: "set";
          value: string;
        }
      | {
          mode: "inherit";
        };
    location:
      | {
          mode: "unset";
        }
      | {
          mode: "unknown";
        }
      | {
          mode: "clear";
        }
      | {
          mode: "set";
          value: {
            observation_id: string;
            target_context_id: string;
            model: "part" | "location";
            pk: string;
          };
        }
      | {
          mode: "inherit";
        };
  }[];
  notes: {
    id: string;
    subject_id: string | null;
    text: string;
    actor_id: string;
    created_at: string;
    producer: "human";
  }[];
  observations: {
    id: string;
    model: "part" | "location";
    pk: string;
    target_context_id: string;
    label: string;
    observed_at: string;
  }[];
  cursor: {
    stream_id: string;
    sequence: string;
  };
}
