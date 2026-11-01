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
  media_enabled?: boolean;
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

export interface ManualScope {
  expected_batch_revision: string;
  /**
   * @minItems 1
   * @maxItems 10
   */
  selected_lot_ids:
    | [string]
    | [string, string]
    | [string, string, string]
    | [string, string, string, string]
    | [string, string, string, string, string]
    | [string, string, string, string, string, string]
    | [string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string];
}

export interface ManualIssue {
  code: string;
  message: string;
  lot_id: string | null;
  run_id: string | null;
}

export interface ManualEffect {
  lot_id: string;
  lot_label: string;
  part_id: string;
  part_label: string;
  quantity: string;
  location_id: string | null;
  location_label: string;
  contribution_key: string;
  barcode: string;
}

export interface ManualPreview {
  id: string;
  batch_id: string;
  /**
   * @minItems 1
   * @maxItems 10
   */
  selected_lot_ids:
    | [string]
    | [string, string]
    | [string, string, string]
    | [string, string, string, string]
    | [string, string, string, string, string]
    | [string, string, string, string, string, string]
    | [string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string];
  remaining_lot_ids: string[];
  plan_sha256: string;
  review_fingerprint: string;
  target_revision: string;
  capability: "owned-fake-stock/1" | "owned-fake-media/1";
  /**
   * @maxItems 10
   */
  attachments?:
    | []
    | [
        {
          version_id: string;
          evidence_id: string;
          blob_sha256: string;
          byte_size: string;
          media_type: "image/jpeg" | "image/png" | "application/pdf";
          kind: "original" | "derived";
          original_version_id: string;
          original_sha256: string;
          recipe_sha256: string | null;
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          evidence_label: string;
          destination: "stock_attachment";
        }
      ]
    | [
        {
          version_id: string;
          evidence_id: string;
          blob_sha256: string;
          byte_size: string;
          media_type: "image/jpeg" | "image/png" | "application/pdf";
          kind: "original" | "derived";
          original_version_id: string;
          original_sha256: string;
          recipe_sha256: string | null;
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          evidence_label: string;
          destination: "stock_attachment";
        },
        {
          version_id: string;
          evidence_id: string;
          blob_sha256: string;
          byte_size: string;
          media_type: "image/jpeg" | "image/png" | "application/pdf";
          kind: "original" | "derived";
          original_version_id: string;
          original_sha256: string;
          recipe_sha256: string | null;
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          evidence_label: string;
          destination: "stock_attachment";
        }
      ]
    | [
        {
          version_id: string;
          evidence_id: string;
          blob_sha256: string;
          byte_size: string;
          media_type: "image/jpeg" | "image/png" | "application/pdf";
          kind: "original" | "derived";
          original_version_id: string;
          original_sha256: string;
          recipe_sha256: string | null;
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          evidence_label: string;
          destination: "stock_attachment";
        },
        {
          version_id: string;
          evidence_id: string;
          blob_sha256: string;
          byte_size: string;
          media_type: "image/jpeg" | "image/png" | "application/pdf";
          kind: "original" | "derived";
          original_version_id: string;
          original_sha256: string;
          recipe_sha256: string | null;
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          evidence_label: string;
          destination: "stock_attachment";
        },
        {
          version_id: string;
          evidence_id: string;
          blob_sha256: string;
          byte_size: string;
          media_type: "image/jpeg" | "image/png" | "application/pdf";
          kind: "original" | "derived";
          original_version_id: string;
          original_sha256: string;
          recipe_sha256: string | null;
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          evidence_label: string;
          destination: "stock_attachment";
        }
      ]
    | [
        {
          version_id: string;
          evidence_id: string;
          blob_sha256: string;
          byte_size: string;
          media_type: "image/jpeg" | "image/png" | "application/pdf";
          kind: "original" | "derived";
          original_version_id: string;
          original_sha256: string;
          recipe_sha256: string | null;
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          evidence_label: string;
          destination: "stock_attachment";
        },
        {
          version_id: string;
          evidence_id: string;
          blob_sha256: string;
          byte_size: string;
          media_type: "image/jpeg" | "image/png" | "application/pdf";
          kind: "original" | "derived";
          original_version_id: string;
          original_sha256: string;
          recipe_sha256: string | null;
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          evidence_label: string;
          destination: "stock_attachment";
        },
        {
          version_id: string;
          evidence_id: string;
          blob_sha256: string;
          byte_size: string;
          media_type: "image/jpeg" | "image/png" | "application/pdf";
          kind: "original" | "derived";
          original_version_id: string;
          original_sha256: string;
          recipe_sha256: string | null;
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          evidence_label: string;
          destination: "stock_attachment";
        },
        {
          version_id: string;
          evidence_id: string;
          blob_sha256: string;
          byte_size: string;
          media_type: "image/jpeg" | "image/png" | "application/pdf";
          kind: "original" | "derived";
          original_version_id: string;
          original_sha256: string;
          recipe_sha256: string | null;
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          evidence_label: string;
          destination: "stock_attachment";
        }
      ]
    | [
        {
          version_id: string;
          evidence_id: string;
          blob_sha256: string;
          byte_size: string;
          media_type: "image/jpeg" | "image/png" | "application/pdf";
          kind: "original" | "derived";
          original_version_id: string;
          original_sha256: string;
          recipe_sha256: string | null;
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          evidence_label: string;
          destination: "stock_attachment";
        },
        {
          version_id: string;
          evidence_id: string;
          blob_sha256: string;
          byte_size: string;
          media_type: "image/jpeg" | "image/png" | "application/pdf";
          kind: "original" | "derived";
          original_version_id: string;
          original_sha256: string;
          recipe_sha256: string | null;
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          evidence_label: string;
          destination: "stock_attachment";
        },
        {
          version_id: string;
          evidence_id: string;
          blob_sha256: string;
          byte_size: string;
          media_type: "image/jpeg" | "image/png" | "application/pdf";
          kind: "original" | "derived";
          original_version_id: string;
          original_sha256: string;
          recipe_sha256: string | null;
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          evidence_label: string;
          destination: "stock_attachment";
        },
        {
          version_id: string;
          evidence_id: string;
          blob_sha256: string;
          byte_size: string;
          media_type: "image/jpeg" | "image/png" | "application/pdf";
          kind: "original" | "derived";
          original_version_id: string;
          original_sha256: string;
          recipe_sha256: string | null;
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          evidence_label: string;
          destination: "stock_attachment";
        },
        {
          version_id: string;
          evidence_id: string;
          blob_sha256: string;
          byte_size: string;
          media_type: "image/jpeg" | "image/png" | "application/pdf";
          kind: "original" | "derived";
          original_version_id: string;
          original_sha256: string;
          recipe_sha256: string | null;
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          evidence_label: string;
          destination: "stock_attachment";
        }
      ]
    | [
        {
          version_id: string;
          evidence_id: string;
          blob_sha256: string;
          byte_size: string;
          media_type: "image/jpeg" | "image/png" | "application/pdf";
          kind: "original" | "derived";
          original_version_id: string;
          original_sha256: string;
          recipe_sha256: string | null;
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          evidence_label: string;
          destination: "stock_attachment";
        },
        {
          version_id: string;
          evidence_id: string;
          blob_sha256: string;
          byte_size: string;
          media_type: "image/jpeg" | "image/png" | "application/pdf";
          kind: "original" | "derived";
          original_version_id: string;
          original_sha256: string;
          recipe_sha256: string | null;
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          evidence_label: string;
          destination: "stock_attachment";
        },
        {
          version_id: string;
          evidence_id: string;
          blob_sha256: string;
          byte_size: string;
          media_type: "image/jpeg" | "image/png" | "application/pdf";
          kind: "original" | "derived";
          original_version_id: string;
          original_sha256: string;
          recipe_sha256: string | null;
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          evidence_label: string;
          destination: "stock_attachment";
        },
        {
          version_id: string;
          evidence_id: string;
          blob_sha256: string;
          byte_size: string;
          media_type: "image/jpeg" | "image/png" | "application/pdf";
          kind: "original" | "derived";
          original_version_id: string;
          original_sha256: string;
          recipe_sha256: string | null;
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          evidence_label: string;
          destination: "stock_attachment";
        },
        {
          version_id: string;
          evidence_id: string;
          blob_sha256: string;
          byte_size: string;
          media_type: "image/jpeg" | "image/png" | "application/pdf";
          kind: "original" | "derived";
          original_version_id: string;
          original_sha256: string;
          recipe_sha256: string | null;
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          evidence_label: string;
          destination: "stock_attachment";
        },
        {
          version_id: string;
          evidence_id: string;
          blob_sha256: string;
          byte_size: string;
          media_type: "image/jpeg" | "image/png" | "application/pdf";
          kind: "original" | "derived";
          original_version_id: string;
          original_sha256: string;
          recipe_sha256: string | null;
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          evidence_label: string;
          destination: "stock_attachment";
        }
      ]
    | [
        {
          version_id: string;
          evidence_id: string;
          blob_sha256: string;
          byte_size: string;
          media_type: "image/jpeg" | "image/png" | "application/pdf";
          kind: "original" | "derived";
          original_version_id: string;
          original_sha256: string;
          recipe_sha256: string | null;
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          evidence_label: string;
          destination: "stock_attachment";
        },
        {
          version_id: string;
          evidence_id: string;
          blob_sha256: string;
          byte_size: string;
          media_type: "image/jpeg" | "image/png" | "application/pdf";
          kind: "original" | "derived";
          original_version_id: string;
          original_sha256: string;
          recipe_sha256: string | null;
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          evidence_label: string;
          destination: "stock_attachment";
        },
        {
          version_id: string;
          evidence_id: string;
          blob_sha256: string;
          byte_size: string;
          media_type: "image/jpeg" | "image/png" | "application/pdf";
          kind: "original" | "derived";
          original_version_id: string;
          original_sha256: string;
          recipe_sha256: string | null;
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          evidence_label: string;
          destination: "stock_attachment";
        },
        {
          version_id: string;
          evidence_id: string;
          blob_sha256: string;
          byte_size: string;
          media_type: "image/jpeg" | "image/png" | "application/pdf";
          kind: "original" | "derived";
          original_version_id: string;
          original_sha256: string;
          recipe_sha256: string | null;
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          evidence_label: string;
          destination: "stock_attachment";
        },
        {
          version_id: string;
          evidence_id: string;
          blob_sha256: string;
          byte_size: string;
          media_type: "image/jpeg" | "image/png" | "application/pdf";
          kind: "original" | "derived";
          original_version_id: string;
          original_sha256: string;
          recipe_sha256: string | null;
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          evidence_label: string;
          destination: "stock_attachment";
        },
        {
          version_id: string;
          evidence_id: string;
          blob_sha256: string;
          byte_size: string;
          media_type: "image/jpeg" | "image/png" | "application/pdf";
          kind: "original" | "derived";
          original_version_id: string;
          original_sha256: string;
          recipe_sha256: string | null;
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          evidence_label: string;
          destination: "stock_attachment";
        },
        {
          version_id: string;
          evidence_id: string;
          blob_sha256: string;
          byte_size: string;
          media_type: "image/jpeg" | "image/png" | "application/pdf";
          kind: "original" | "derived";
          original_version_id: string;
          original_sha256: string;
          recipe_sha256: string | null;
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          evidence_label: string;
          destination: "stock_attachment";
        }
      ]
    | [
        {
          version_id: string;
          evidence_id: string;
          blob_sha256: string;
          byte_size: string;
          media_type: "image/jpeg" | "image/png" | "application/pdf";
          kind: "original" | "derived";
          original_version_id: string;
          original_sha256: string;
          recipe_sha256: string | null;
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          evidence_label: string;
          destination: "stock_attachment";
        },
        {
          version_id: string;
          evidence_id: string;
          blob_sha256: string;
          byte_size: string;
          media_type: "image/jpeg" | "image/png" | "application/pdf";
          kind: "original" | "derived";
          original_version_id: string;
          original_sha256: string;
          recipe_sha256: string | null;
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          evidence_label: string;
          destination: "stock_attachment";
        },
        {
          version_id: string;
          evidence_id: string;
          blob_sha256: string;
          byte_size: string;
          media_type: "image/jpeg" | "image/png" | "application/pdf";
          kind: "original" | "derived";
          original_version_id: string;
          original_sha256: string;
          recipe_sha256: string | null;
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          evidence_label: string;
          destination: "stock_attachment";
        },
        {
          version_id: string;
          evidence_id: string;
          blob_sha256: string;
          byte_size: string;
          media_type: "image/jpeg" | "image/png" | "application/pdf";
          kind: "original" | "derived";
          original_version_id: string;
          original_sha256: string;
          recipe_sha256: string | null;
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          evidence_label: string;
          destination: "stock_attachment";
        },
        {
          version_id: string;
          evidence_id: string;
          blob_sha256: string;
          byte_size: string;
          media_type: "image/jpeg" | "image/png" | "application/pdf";
          kind: "original" | "derived";
          original_version_id: string;
          original_sha256: string;
          recipe_sha256: string | null;
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          evidence_label: string;
          destination: "stock_attachment";
        },
        {
          version_id: string;
          evidence_id: string;
          blob_sha256: string;
          byte_size: string;
          media_type: "image/jpeg" | "image/png" | "application/pdf";
          kind: "original" | "derived";
          original_version_id: string;
          original_sha256: string;
          recipe_sha256: string | null;
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          evidence_label: string;
          destination: "stock_attachment";
        },
        {
          version_id: string;
          evidence_id: string;
          blob_sha256: string;
          byte_size: string;
          media_type: "image/jpeg" | "image/png" | "application/pdf";
          kind: "original" | "derived";
          original_version_id: string;
          original_sha256: string;
          recipe_sha256: string | null;
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          evidence_label: string;
          destination: "stock_attachment";
        },
        {
          version_id: string;
          evidence_id: string;
          blob_sha256: string;
          byte_size: string;
          media_type: "image/jpeg" | "image/png" | "application/pdf";
          kind: "original" | "derived";
          original_version_id: string;
          original_sha256: string;
          recipe_sha256: string | null;
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          evidence_label: string;
          destination: "stock_attachment";
        }
      ]
    | [
        {
          version_id: string;
          evidence_id: string;
          blob_sha256: string;
          byte_size: string;
          media_type: "image/jpeg" | "image/png" | "application/pdf";
          kind: "original" | "derived";
          original_version_id: string;
          original_sha256: string;
          recipe_sha256: string | null;
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          evidence_label: string;
          destination: "stock_attachment";
        },
        {
          version_id: string;
          evidence_id: string;
          blob_sha256: string;
          byte_size: string;
          media_type: "image/jpeg" | "image/png" | "application/pdf";
          kind: "original" | "derived";
          original_version_id: string;
          original_sha256: string;
          recipe_sha256: string | null;
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          evidence_label: string;
          destination: "stock_attachment";
        },
        {
          version_id: string;
          evidence_id: string;
          blob_sha256: string;
          byte_size: string;
          media_type: "image/jpeg" | "image/png" | "application/pdf";
          kind: "original" | "derived";
          original_version_id: string;
          original_sha256: string;
          recipe_sha256: string | null;
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          evidence_label: string;
          destination: "stock_attachment";
        },
        {
          version_id: string;
          evidence_id: string;
          blob_sha256: string;
          byte_size: string;
          media_type: "image/jpeg" | "image/png" | "application/pdf";
          kind: "original" | "derived";
          original_version_id: string;
          original_sha256: string;
          recipe_sha256: string | null;
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          evidence_label: string;
          destination: "stock_attachment";
        },
        {
          version_id: string;
          evidence_id: string;
          blob_sha256: string;
          byte_size: string;
          media_type: "image/jpeg" | "image/png" | "application/pdf";
          kind: "original" | "derived";
          original_version_id: string;
          original_sha256: string;
          recipe_sha256: string | null;
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          evidence_label: string;
          destination: "stock_attachment";
        },
        {
          version_id: string;
          evidence_id: string;
          blob_sha256: string;
          byte_size: string;
          media_type: "image/jpeg" | "image/png" | "application/pdf";
          kind: "original" | "derived";
          original_version_id: string;
          original_sha256: string;
          recipe_sha256: string | null;
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          evidence_label: string;
          destination: "stock_attachment";
        },
        {
          version_id: string;
          evidence_id: string;
          blob_sha256: string;
          byte_size: string;
          media_type: "image/jpeg" | "image/png" | "application/pdf";
          kind: "original" | "derived";
          original_version_id: string;
          original_sha256: string;
          recipe_sha256: string | null;
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          evidence_label: string;
          destination: "stock_attachment";
        },
        {
          version_id: string;
          evidence_id: string;
          blob_sha256: string;
          byte_size: string;
          media_type: "image/jpeg" | "image/png" | "application/pdf";
          kind: "original" | "derived";
          original_version_id: string;
          original_sha256: string;
          recipe_sha256: string | null;
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          evidence_label: string;
          destination: "stock_attachment";
        },
        {
          version_id: string;
          evidence_id: string;
          blob_sha256: string;
          byte_size: string;
          media_type: "image/jpeg" | "image/png" | "application/pdf";
          kind: "original" | "derived";
          original_version_id: string;
          original_sha256: string;
          recipe_sha256: string | null;
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          evidence_label: string;
          destination: "stock_attachment";
        }
      ]
    | [
        {
          version_id: string;
          evidence_id: string;
          blob_sha256: string;
          byte_size: string;
          media_type: "image/jpeg" | "image/png" | "application/pdf";
          kind: "original" | "derived";
          original_version_id: string;
          original_sha256: string;
          recipe_sha256: string | null;
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          evidence_label: string;
          destination: "stock_attachment";
        },
        {
          version_id: string;
          evidence_id: string;
          blob_sha256: string;
          byte_size: string;
          media_type: "image/jpeg" | "image/png" | "application/pdf";
          kind: "original" | "derived";
          original_version_id: string;
          original_sha256: string;
          recipe_sha256: string | null;
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          evidence_label: string;
          destination: "stock_attachment";
        },
        {
          version_id: string;
          evidence_id: string;
          blob_sha256: string;
          byte_size: string;
          media_type: "image/jpeg" | "image/png" | "application/pdf";
          kind: "original" | "derived";
          original_version_id: string;
          original_sha256: string;
          recipe_sha256: string | null;
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          evidence_label: string;
          destination: "stock_attachment";
        },
        {
          version_id: string;
          evidence_id: string;
          blob_sha256: string;
          byte_size: string;
          media_type: "image/jpeg" | "image/png" | "application/pdf";
          kind: "original" | "derived";
          original_version_id: string;
          original_sha256: string;
          recipe_sha256: string | null;
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          evidence_label: string;
          destination: "stock_attachment";
        },
        {
          version_id: string;
          evidence_id: string;
          blob_sha256: string;
          byte_size: string;
          media_type: "image/jpeg" | "image/png" | "application/pdf";
          kind: "original" | "derived";
          original_version_id: string;
          original_sha256: string;
          recipe_sha256: string | null;
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          evidence_label: string;
          destination: "stock_attachment";
        },
        {
          version_id: string;
          evidence_id: string;
          blob_sha256: string;
          byte_size: string;
          media_type: "image/jpeg" | "image/png" | "application/pdf";
          kind: "original" | "derived";
          original_version_id: string;
          original_sha256: string;
          recipe_sha256: string | null;
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          evidence_label: string;
          destination: "stock_attachment";
        },
        {
          version_id: string;
          evidence_id: string;
          blob_sha256: string;
          byte_size: string;
          media_type: "image/jpeg" | "image/png" | "application/pdf";
          kind: "original" | "derived";
          original_version_id: string;
          original_sha256: string;
          recipe_sha256: string | null;
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          evidence_label: string;
          destination: "stock_attachment";
        },
        {
          version_id: string;
          evidence_id: string;
          blob_sha256: string;
          byte_size: string;
          media_type: "image/jpeg" | "image/png" | "application/pdf";
          kind: "original" | "derived";
          original_version_id: string;
          original_sha256: string;
          recipe_sha256: string | null;
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          evidence_label: string;
          destination: "stock_attachment";
        },
        {
          version_id: string;
          evidence_id: string;
          blob_sha256: string;
          byte_size: string;
          media_type: "image/jpeg" | "image/png" | "application/pdf";
          kind: "original" | "derived";
          original_version_id: string;
          original_sha256: string;
          recipe_sha256: string | null;
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          evidence_label: string;
          destination: "stock_attachment";
        },
        {
          version_id: string;
          evidence_id: string;
          blob_sha256: string;
          byte_size: string;
          media_type: "image/jpeg" | "image/png" | "application/pdf";
          kind: "original" | "derived";
          original_version_id: string;
          original_sha256: string;
          recipe_sha256: string | null;
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          evidence_label: string;
          destination: "stock_attachment";
        }
      ];
  /**
   * @maxItems 64
   */
  evidence?: {
    version_id: string;
    evidence_id: string;
    blob_sha256: string;
    byte_size: string;
    media_type: "image/jpeg" | "image/png" | "application/pdf";
    kind: "original" | "derived";
    original_version_id: string;
    original_sha256: string;
    recipe_sha256: string | null;
  }[];
  media_inputs_sha256?: string;
  /**
   * @minItems 1
   * @maxItems 10
   */
  effects:
    | [
        {
          lot_id: string;
          lot_label: string;
          part_id: string;
          part_label: string;
          quantity: string;
          location_id: string | null;
          location_label: string;
          contribution_key: string;
          barcode: string;
        }
      ]
    | [
        {
          lot_id: string;
          lot_label: string;
          part_id: string;
          part_label: string;
          quantity: string;
          location_id: string | null;
          location_label: string;
          contribution_key: string;
          barcode: string;
        },
        {
          lot_id: string;
          lot_label: string;
          part_id: string;
          part_label: string;
          quantity: string;
          location_id: string | null;
          location_label: string;
          contribution_key: string;
          barcode: string;
        }
      ]
    | [
        {
          lot_id: string;
          lot_label: string;
          part_id: string;
          part_label: string;
          quantity: string;
          location_id: string | null;
          location_label: string;
          contribution_key: string;
          barcode: string;
        },
        {
          lot_id: string;
          lot_label: string;
          part_id: string;
          part_label: string;
          quantity: string;
          location_id: string | null;
          location_label: string;
          contribution_key: string;
          barcode: string;
        },
        {
          lot_id: string;
          lot_label: string;
          part_id: string;
          part_label: string;
          quantity: string;
          location_id: string | null;
          location_label: string;
          contribution_key: string;
          barcode: string;
        }
      ]
    | [
        {
          lot_id: string;
          lot_label: string;
          part_id: string;
          part_label: string;
          quantity: string;
          location_id: string | null;
          location_label: string;
          contribution_key: string;
          barcode: string;
        },
        {
          lot_id: string;
          lot_label: string;
          part_id: string;
          part_label: string;
          quantity: string;
          location_id: string | null;
          location_label: string;
          contribution_key: string;
          barcode: string;
        },
        {
          lot_id: string;
          lot_label: string;
          part_id: string;
          part_label: string;
          quantity: string;
          location_id: string | null;
          location_label: string;
          contribution_key: string;
          barcode: string;
        },
        {
          lot_id: string;
          lot_label: string;
          part_id: string;
          part_label: string;
          quantity: string;
          location_id: string | null;
          location_label: string;
          contribution_key: string;
          barcode: string;
        }
      ]
    | [
        {
          lot_id: string;
          lot_label: string;
          part_id: string;
          part_label: string;
          quantity: string;
          location_id: string | null;
          location_label: string;
          contribution_key: string;
          barcode: string;
        },
        {
          lot_id: string;
          lot_label: string;
          part_id: string;
          part_label: string;
          quantity: string;
          location_id: string | null;
          location_label: string;
          contribution_key: string;
          barcode: string;
        },
        {
          lot_id: string;
          lot_label: string;
          part_id: string;
          part_label: string;
          quantity: string;
          location_id: string | null;
          location_label: string;
          contribution_key: string;
          barcode: string;
        },
        {
          lot_id: string;
          lot_label: string;
          part_id: string;
          part_label: string;
          quantity: string;
          location_id: string | null;
          location_label: string;
          contribution_key: string;
          barcode: string;
        },
        {
          lot_id: string;
          lot_label: string;
          part_id: string;
          part_label: string;
          quantity: string;
          location_id: string | null;
          location_label: string;
          contribution_key: string;
          barcode: string;
        }
      ]
    | [
        {
          lot_id: string;
          lot_label: string;
          part_id: string;
          part_label: string;
          quantity: string;
          location_id: string | null;
          location_label: string;
          contribution_key: string;
          barcode: string;
        },
        {
          lot_id: string;
          lot_label: string;
          part_id: string;
          part_label: string;
          quantity: string;
          location_id: string | null;
          location_label: string;
          contribution_key: string;
          barcode: string;
        },
        {
          lot_id: string;
          lot_label: string;
          part_id: string;
          part_label: string;
          quantity: string;
          location_id: string | null;
          location_label: string;
          contribution_key: string;
          barcode: string;
        },
        {
          lot_id: string;
          lot_label: string;
          part_id: string;
          part_label: string;
          quantity: string;
          location_id: string | null;
          location_label: string;
          contribution_key: string;
          barcode: string;
        },
        {
          lot_id: string;
          lot_label: string;
          part_id: string;
          part_label: string;
          quantity: string;
          location_id: string | null;
          location_label: string;
          contribution_key: string;
          barcode: string;
        },
        {
          lot_id: string;
          lot_label: string;
          part_id: string;
          part_label: string;
          quantity: string;
          location_id: string | null;
          location_label: string;
          contribution_key: string;
          barcode: string;
        }
      ]
    | [
        {
          lot_id: string;
          lot_label: string;
          part_id: string;
          part_label: string;
          quantity: string;
          location_id: string | null;
          location_label: string;
          contribution_key: string;
          barcode: string;
        },
        {
          lot_id: string;
          lot_label: string;
          part_id: string;
          part_label: string;
          quantity: string;
          location_id: string | null;
          location_label: string;
          contribution_key: string;
          barcode: string;
        },
        {
          lot_id: string;
          lot_label: string;
          part_id: string;
          part_label: string;
          quantity: string;
          location_id: string | null;
          location_label: string;
          contribution_key: string;
          barcode: string;
        },
        {
          lot_id: string;
          lot_label: string;
          part_id: string;
          part_label: string;
          quantity: string;
          location_id: string | null;
          location_label: string;
          contribution_key: string;
          barcode: string;
        },
        {
          lot_id: string;
          lot_label: string;
          part_id: string;
          part_label: string;
          quantity: string;
          location_id: string | null;
          location_label: string;
          contribution_key: string;
          barcode: string;
        },
        {
          lot_id: string;
          lot_label: string;
          part_id: string;
          part_label: string;
          quantity: string;
          location_id: string | null;
          location_label: string;
          contribution_key: string;
          barcode: string;
        },
        {
          lot_id: string;
          lot_label: string;
          part_id: string;
          part_label: string;
          quantity: string;
          location_id: string | null;
          location_label: string;
          contribution_key: string;
          barcode: string;
        }
      ]
    | [
        {
          lot_id: string;
          lot_label: string;
          part_id: string;
          part_label: string;
          quantity: string;
          location_id: string | null;
          location_label: string;
          contribution_key: string;
          barcode: string;
        },
        {
          lot_id: string;
          lot_label: string;
          part_id: string;
          part_label: string;
          quantity: string;
          location_id: string | null;
          location_label: string;
          contribution_key: string;
          barcode: string;
        },
        {
          lot_id: string;
          lot_label: string;
          part_id: string;
          part_label: string;
          quantity: string;
          location_id: string | null;
          location_label: string;
          contribution_key: string;
          barcode: string;
        },
        {
          lot_id: string;
          lot_label: string;
          part_id: string;
          part_label: string;
          quantity: string;
          location_id: string | null;
          location_label: string;
          contribution_key: string;
          barcode: string;
        },
        {
          lot_id: string;
          lot_label: string;
          part_id: string;
          part_label: string;
          quantity: string;
          location_id: string | null;
          location_label: string;
          contribution_key: string;
          barcode: string;
        },
        {
          lot_id: string;
          lot_label: string;
          part_id: string;
          part_label: string;
          quantity: string;
          location_id: string | null;
          location_label: string;
          contribution_key: string;
          barcode: string;
        },
        {
          lot_id: string;
          lot_label: string;
          part_id: string;
          part_label: string;
          quantity: string;
          location_id: string | null;
          location_label: string;
          contribution_key: string;
          barcode: string;
        },
        {
          lot_id: string;
          lot_label: string;
          part_id: string;
          part_label: string;
          quantity: string;
          location_id: string | null;
          location_label: string;
          contribution_key: string;
          barcode: string;
        }
      ]
    | [
        {
          lot_id: string;
          lot_label: string;
          part_id: string;
          part_label: string;
          quantity: string;
          location_id: string | null;
          location_label: string;
          contribution_key: string;
          barcode: string;
        },
        {
          lot_id: string;
          lot_label: string;
          part_id: string;
          part_label: string;
          quantity: string;
          location_id: string | null;
          location_label: string;
          contribution_key: string;
          barcode: string;
        },
        {
          lot_id: string;
          lot_label: string;
          part_id: string;
          part_label: string;
          quantity: string;
          location_id: string | null;
          location_label: string;
          contribution_key: string;
          barcode: string;
        },
        {
          lot_id: string;
          lot_label: string;
          part_id: string;
          part_label: string;
          quantity: string;
          location_id: string | null;
          location_label: string;
          contribution_key: string;
          barcode: string;
        },
        {
          lot_id: string;
          lot_label: string;
          part_id: string;
          part_label: string;
          quantity: string;
          location_id: string | null;
          location_label: string;
          contribution_key: string;
          barcode: string;
        },
        {
          lot_id: string;
          lot_label: string;
          part_id: string;
          part_label: string;
          quantity: string;
          location_id: string | null;
          location_label: string;
          contribution_key: string;
          barcode: string;
        },
        {
          lot_id: string;
          lot_label: string;
          part_id: string;
          part_label: string;
          quantity: string;
          location_id: string | null;
          location_label: string;
          contribution_key: string;
          barcode: string;
        },
        {
          lot_id: string;
          lot_label: string;
          part_id: string;
          part_label: string;
          quantity: string;
          location_id: string | null;
          location_label: string;
          contribution_key: string;
          barcode: string;
        },
        {
          lot_id: string;
          lot_label: string;
          part_id: string;
          part_label: string;
          quantity: string;
          location_id: string | null;
          location_label: string;
          contribution_key: string;
          barcode: string;
        }
      ]
    | [
        {
          lot_id: string;
          lot_label: string;
          part_id: string;
          part_label: string;
          quantity: string;
          location_id: string | null;
          location_label: string;
          contribution_key: string;
          barcode: string;
        },
        {
          lot_id: string;
          lot_label: string;
          part_id: string;
          part_label: string;
          quantity: string;
          location_id: string | null;
          location_label: string;
          contribution_key: string;
          barcode: string;
        },
        {
          lot_id: string;
          lot_label: string;
          part_id: string;
          part_label: string;
          quantity: string;
          location_id: string | null;
          location_label: string;
          contribution_key: string;
          barcode: string;
        },
        {
          lot_id: string;
          lot_label: string;
          part_id: string;
          part_label: string;
          quantity: string;
          location_id: string | null;
          location_label: string;
          contribution_key: string;
          barcode: string;
        },
        {
          lot_id: string;
          lot_label: string;
          part_id: string;
          part_label: string;
          quantity: string;
          location_id: string | null;
          location_label: string;
          contribution_key: string;
          barcode: string;
        },
        {
          lot_id: string;
          lot_label: string;
          part_id: string;
          part_label: string;
          quantity: string;
          location_id: string | null;
          location_label: string;
          contribution_key: string;
          barcode: string;
        },
        {
          lot_id: string;
          lot_label: string;
          part_id: string;
          part_label: string;
          quantity: string;
          location_id: string | null;
          location_label: string;
          contribution_key: string;
          barcode: string;
        },
        {
          lot_id: string;
          lot_label: string;
          part_id: string;
          part_label: string;
          quantity: string;
          location_id: string | null;
          location_label: string;
          contribution_key: string;
          barcode: string;
        },
        {
          lot_id: string;
          lot_label: string;
          part_id: string;
          part_label: string;
          quantity: string;
          location_id: string | null;
          location_label: string;
          contribution_key: string;
          barcode: string;
        },
        {
          lot_id: string;
          lot_label: string;
          part_id: string;
          part_label: string;
          quantity: string;
          location_id: string | null;
          location_label: string;
          contribution_key: string;
          barcode: string;
        }
      ];
}

export interface ManualAttachment {
  version_id: string;
  evidence_id: string;
  blob_sha256: string;
  byte_size: string;
  media_type: "image/jpeg" | "image/png" | "application/pdf";
  kind: "original" | "derived";
  original_version_id: string;
  original_sha256: string;
  recipe_sha256: string | null;
  artifact_key: string;
  lot_id: string;
  lot_label: string;
  evidence_label: string;
  destination: "stock_attachment";
}

export interface ManualMediaEvidence {
  version_id: string;
  evidence_id: string;
  blob_sha256: string;
  byte_size: string;
  media_type: "image/jpeg" | "image/png" | "application/pdf";
  kind: "original" | "derived";
  original_version_id: string;
  original_sha256: string;
  recipe_sha256: string | null;
}

export type ManualPreparationResult =
  | {
      status: "prepared";
      preparation: {
        id: string;
        batch_id: string;
        /**
         * @minItems 1
         * @maxItems 10
         */
        selected_lot_ids:
          | [string]
          | [string, string]
          | [string, string, string]
          | [string, string, string, string]
          | [string, string, string, string, string]
          | [string, string, string, string, string, string]
          | [string, string, string, string, string, string, string]
          | [string, string, string, string, string, string, string, string]
          | [string, string, string, string, string, string, string, string, string]
          | [string, string, string, string, string, string, string, string, string, string];
        remaining_lot_ids: string[];
        plan_sha256: string;
        review_fingerprint: string;
        target_revision: string;
        capability: "owned-fake-stock/1" | "owned-fake-media/1";
        /**
         * @maxItems 10
         */
        attachments?:
          | []
          | [
              {
                version_id: string;
                evidence_id: string;
                blob_sha256: string;
                byte_size: string;
                media_type: "image/jpeg" | "image/png" | "application/pdf";
                kind: "original" | "derived";
                original_version_id: string;
                original_sha256: string;
                recipe_sha256: string | null;
                artifact_key: string;
                lot_id: string;
                lot_label: string;
                evidence_label: string;
                destination: "stock_attachment";
              }
            ]
          | [
              {
                version_id: string;
                evidence_id: string;
                blob_sha256: string;
                byte_size: string;
                media_type: "image/jpeg" | "image/png" | "application/pdf";
                kind: "original" | "derived";
                original_version_id: string;
                original_sha256: string;
                recipe_sha256: string | null;
                artifact_key: string;
                lot_id: string;
                lot_label: string;
                evidence_label: string;
                destination: "stock_attachment";
              },
              {
                version_id: string;
                evidence_id: string;
                blob_sha256: string;
                byte_size: string;
                media_type: "image/jpeg" | "image/png" | "application/pdf";
                kind: "original" | "derived";
                original_version_id: string;
                original_sha256: string;
                recipe_sha256: string | null;
                artifact_key: string;
                lot_id: string;
                lot_label: string;
                evidence_label: string;
                destination: "stock_attachment";
              }
            ]
          | [
              {
                version_id: string;
                evidence_id: string;
                blob_sha256: string;
                byte_size: string;
                media_type: "image/jpeg" | "image/png" | "application/pdf";
                kind: "original" | "derived";
                original_version_id: string;
                original_sha256: string;
                recipe_sha256: string | null;
                artifact_key: string;
                lot_id: string;
                lot_label: string;
                evidence_label: string;
                destination: "stock_attachment";
              },
              {
                version_id: string;
                evidence_id: string;
                blob_sha256: string;
                byte_size: string;
                media_type: "image/jpeg" | "image/png" | "application/pdf";
                kind: "original" | "derived";
                original_version_id: string;
                original_sha256: string;
                recipe_sha256: string | null;
                artifact_key: string;
                lot_id: string;
                lot_label: string;
                evidence_label: string;
                destination: "stock_attachment";
              },
              {
                version_id: string;
                evidence_id: string;
                blob_sha256: string;
                byte_size: string;
                media_type: "image/jpeg" | "image/png" | "application/pdf";
                kind: "original" | "derived";
                original_version_id: string;
                original_sha256: string;
                recipe_sha256: string | null;
                artifact_key: string;
                lot_id: string;
                lot_label: string;
                evidence_label: string;
                destination: "stock_attachment";
              }
            ]
          | [
              {
                version_id: string;
                evidence_id: string;
                blob_sha256: string;
                byte_size: string;
                media_type: "image/jpeg" | "image/png" | "application/pdf";
                kind: "original" | "derived";
                original_version_id: string;
                original_sha256: string;
                recipe_sha256: string | null;
                artifact_key: string;
                lot_id: string;
                lot_label: string;
                evidence_label: string;
                destination: "stock_attachment";
              },
              {
                version_id: string;
                evidence_id: string;
                blob_sha256: string;
                byte_size: string;
                media_type: "image/jpeg" | "image/png" | "application/pdf";
                kind: "original" | "derived";
                original_version_id: string;
                original_sha256: string;
                recipe_sha256: string | null;
                artifact_key: string;
                lot_id: string;
                lot_label: string;
                evidence_label: string;
                destination: "stock_attachment";
              },
              {
                version_id: string;
                evidence_id: string;
                blob_sha256: string;
                byte_size: string;
                media_type: "image/jpeg" | "image/png" | "application/pdf";
                kind: "original" | "derived";
                original_version_id: string;
                original_sha256: string;
                recipe_sha256: string | null;
                artifact_key: string;
                lot_id: string;
                lot_label: string;
                evidence_label: string;
                destination: "stock_attachment";
              },
              {
                version_id: string;
                evidence_id: string;
                blob_sha256: string;
                byte_size: string;
                media_type: "image/jpeg" | "image/png" | "application/pdf";
                kind: "original" | "derived";
                original_version_id: string;
                original_sha256: string;
                recipe_sha256: string | null;
                artifact_key: string;
                lot_id: string;
                lot_label: string;
                evidence_label: string;
                destination: "stock_attachment";
              }
            ]
          | [
              {
                version_id: string;
                evidence_id: string;
                blob_sha256: string;
                byte_size: string;
                media_type: "image/jpeg" | "image/png" | "application/pdf";
                kind: "original" | "derived";
                original_version_id: string;
                original_sha256: string;
                recipe_sha256: string | null;
                artifact_key: string;
                lot_id: string;
                lot_label: string;
                evidence_label: string;
                destination: "stock_attachment";
              },
              {
                version_id: string;
                evidence_id: string;
                blob_sha256: string;
                byte_size: string;
                media_type: "image/jpeg" | "image/png" | "application/pdf";
                kind: "original" | "derived";
                original_version_id: string;
                original_sha256: string;
                recipe_sha256: string | null;
                artifact_key: string;
                lot_id: string;
                lot_label: string;
                evidence_label: string;
                destination: "stock_attachment";
              },
              {
                version_id: string;
                evidence_id: string;
                blob_sha256: string;
                byte_size: string;
                media_type: "image/jpeg" | "image/png" | "application/pdf";
                kind: "original" | "derived";
                original_version_id: string;
                original_sha256: string;
                recipe_sha256: string | null;
                artifact_key: string;
                lot_id: string;
                lot_label: string;
                evidence_label: string;
                destination: "stock_attachment";
              },
              {
                version_id: string;
                evidence_id: string;
                blob_sha256: string;
                byte_size: string;
                media_type: "image/jpeg" | "image/png" | "application/pdf";
                kind: "original" | "derived";
                original_version_id: string;
                original_sha256: string;
                recipe_sha256: string | null;
                artifact_key: string;
                lot_id: string;
                lot_label: string;
                evidence_label: string;
                destination: "stock_attachment";
              },
              {
                version_id: string;
                evidence_id: string;
                blob_sha256: string;
                byte_size: string;
                media_type: "image/jpeg" | "image/png" | "application/pdf";
                kind: "original" | "derived";
                original_version_id: string;
                original_sha256: string;
                recipe_sha256: string | null;
                artifact_key: string;
                lot_id: string;
                lot_label: string;
                evidence_label: string;
                destination: "stock_attachment";
              }
            ]
          | [
              {
                version_id: string;
                evidence_id: string;
                blob_sha256: string;
                byte_size: string;
                media_type: "image/jpeg" | "image/png" | "application/pdf";
                kind: "original" | "derived";
                original_version_id: string;
                original_sha256: string;
                recipe_sha256: string | null;
                artifact_key: string;
                lot_id: string;
                lot_label: string;
                evidence_label: string;
                destination: "stock_attachment";
              },
              {
                version_id: string;
                evidence_id: string;
                blob_sha256: string;
                byte_size: string;
                media_type: "image/jpeg" | "image/png" | "application/pdf";
                kind: "original" | "derived";
                original_version_id: string;
                original_sha256: string;
                recipe_sha256: string | null;
                artifact_key: string;
                lot_id: string;
                lot_label: string;
                evidence_label: string;
                destination: "stock_attachment";
              },
              {
                version_id: string;
                evidence_id: string;
                blob_sha256: string;
                byte_size: string;
                media_type: "image/jpeg" | "image/png" | "application/pdf";
                kind: "original" | "derived";
                original_version_id: string;
                original_sha256: string;
                recipe_sha256: string | null;
                artifact_key: string;
                lot_id: string;
                lot_label: string;
                evidence_label: string;
                destination: "stock_attachment";
              },
              {
                version_id: string;
                evidence_id: string;
                blob_sha256: string;
                byte_size: string;
                media_type: "image/jpeg" | "image/png" | "application/pdf";
                kind: "original" | "derived";
                original_version_id: string;
                original_sha256: string;
                recipe_sha256: string | null;
                artifact_key: string;
                lot_id: string;
                lot_label: string;
                evidence_label: string;
                destination: "stock_attachment";
              },
              {
                version_id: string;
                evidence_id: string;
                blob_sha256: string;
                byte_size: string;
                media_type: "image/jpeg" | "image/png" | "application/pdf";
                kind: "original" | "derived";
                original_version_id: string;
                original_sha256: string;
                recipe_sha256: string | null;
                artifact_key: string;
                lot_id: string;
                lot_label: string;
                evidence_label: string;
                destination: "stock_attachment";
              },
              {
                version_id: string;
                evidence_id: string;
                blob_sha256: string;
                byte_size: string;
                media_type: "image/jpeg" | "image/png" | "application/pdf";
                kind: "original" | "derived";
                original_version_id: string;
                original_sha256: string;
                recipe_sha256: string | null;
                artifact_key: string;
                lot_id: string;
                lot_label: string;
                evidence_label: string;
                destination: "stock_attachment";
              }
            ]
          | [
              {
                version_id: string;
                evidence_id: string;
                blob_sha256: string;
                byte_size: string;
                media_type: "image/jpeg" | "image/png" | "application/pdf";
                kind: "original" | "derived";
                original_version_id: string;
                original_sha256: string;
                recipe_sha256: string | null;
                artifact_key: string;
                lot_id: string;
                lot_label: string;
                evidence_label: string;
                destination: "stock_attachment";
              },
              {
                version_id: string;
                evidence_id: string;
                blob_sha256: string;
                byte_size: string;
                media_type: "image/jpeg" | "image/png" | "application/pdf";
                kind: "original" | "derived";
                original_version_id: string;
                original_sha256: string;
                recipe_sha256: string | null;
                artifact_key: string;
                lot_id: string;
                lot_label: string;
                evidence_label: string;
                destination: "stock_attachment";
              },
              {
                version_id: string;
                evidence_id: string;
                blob_sha256: string;
                byte_size: string;
                media_type: "image/jpeg" | "image/png" | "application/pdf";
                kind: "original" | "derived";
                original_version_id: string;
                original_sha256: string;
                recipe_sha256: string | null;
                artifact_key: string;
                lot_id: string;
                lot_label: string;
                evidence_label: string;
                destination: "stock_attachment";
              },
              {
                version_id: string;
                evidence_id: string;
                blob_sha256: string;
                byte_size: string;
                media_type: "image/jpeg" | "image/png" | "application/pdf";
                kind: "original" | "derived";
                original_version_id: string;
                original_sha256: string;
                recipe_sha256: string | null;
                artifact_key: string;
                lot_id: string;
                lot_label: string;
                evidence_label: string;
                destination: "stock_attachment";
              },
              {
                version_id: string;
                evidence_id: string;
                blob_sha256: string;
                byte_size: string;
                media_type: "image/jpeg" | "image/png" | "application/pdf";
                kind: "original" | "derived";
                original_version_id: string;
                original_sha256: string;
                recipe_sha256: string | null;
                artifact_key: string;
                lot_id: string;
                lot_label: string;
                evidence_label: string;
                destination: "stock_attachment";
              },
              {
                version_id: string;
                evidence_id: string;
                blob_sha256: string;
                byte_size: string;
                media_type: "image/jpeg" | "image/png" | "application/pdf";
                kind: "original" | "derived";
                original_version_id: string;
                original_sha256: string;
                recipe_sha256: string | null;
                artifact_key: string;
                lot_id: string;
                lot_label: string;
                evidence_label: string;
                destination: "stock_attachment";
              },
              {
                version_id: string;
                evidence_id: string;
                blob_sha256: string;
                byte_size: string;
                media_type: "image/jpeg" | "image/png" | "application/pdf";
                kind: "original" | "derived";
                original_version_id: string;
                original_sha256: string;
                recipe_sha256: string | null;
                artifact_key: string;
                lot_id: string;
                lot_label: string;
                evidence_label: string;
                destination: "stock_attachment";
              }
            ]
          | [
              {
                version_id: string;
                evidence_id: string;
                blob_sha256: string;
                byte_size: string;
                media_type: "image/jpeg" | "image/png" | "application/pdf";
                kind: "original" | "derived";
                original_version_id: string;
                original_sha256: string;
                recipe_sha256: string | null;
                artifact_key: string;
                lot_id: string;
                lot_label: string;
                evidence_label: string;
                destination: "stock_attachment";
              },
              {
                version_id: string;
                evidence_id: string;
                blob_sha256: string;
                byte_size: string;
                media_type: "image/jpeg" | "image/png" | "application/pdf";
                kind: "original" | "derived";
                original_version_id: string;
                original_sha256: string;
                recipe_sha256: string | null;
                artifact_key: string;
                lot_id: string;
                lot_label: string;
                evidence_label: string;
                destination: "stock_attachment";
              },
              {
                version_id: string;
                evidence_id: string;
                blob_sha256: string;
                byte_size: string;
                media_type: "image/jpeg" | "image/png" | "application/pdf";
                kind: "original" | "derived";
                original_version_id: string;
                original_sha256: string;
                recipe_sha256: string | null;
                artifact_key: string;
                lot_id: string;
                lot_label: string;
                evidence_label: string;
                destination: "stock_attachment";
              },
              {
                version_id: string;
                evidence_id: string;
                blob_sha256: string;
                byte_size: string;
                media_type: "image/jpeg" | "image/png" | "application/pdf";
                kind: "original" | "derived";
                original_version_id: string;
                original_sha256: string;
                recipe_sha256: string | null;
                artifact_key: string;
                lot_id: string;
                lot_label: string;
                evidence_label: string;
                destination: "stock_attachment";
              },
              {
                version_id: string;
                evidence_id: string;
                blob_sha256: string;
                byte_size: string;
                media_type: "image/jpeg" | "image/png" | "application/pdf";
                kind: "original" | "derived";
                original_version_id: string;
                original_sha256: string;
                recipe_sha256: string | null;
                artifact_key: string;
                lot_id: string;
                lot_label: string;
                evidence_label: string;
                destination: "stock_attachment";
              },
              {
                version_id: string;
                evidence_id: string;
                blob_sha256: string;
                byte_size: string;
                media_type: "image/jpeg" | "image/png" | "application/pdf";
                kind: "original" | "derived";
                original_version_id: string;
                original_sha256: string;
                recipe_sha256: string | null;
                artifact_key: string;
                lot_id: string;
                lot_label: string;
                evidence_label: string;
                destination: "stock_attachment";
              },
              {
                version_id: string;
                evidence_id: string;
                blob_sha256: string;
                byte_size: string;
                media_type: "image/jpeg" | "image/png" | "application/pdf";
                kind: "original" | "derived";
                original_version_id: string;
                original_sha256: string;
                recipe_sha256: string | null;
                artifact_key: string;
                lot_id: string;
                lot_label: string;
                evidence_label: string;
                destination: "stock_attachment";
              },
              {
                version_id: string;
                evidence_id: string;
                blob_sha256: string;
                byte_size: string;
                media_type: "image/jpeg" | "image/png" | "application/pdf";
                kind: "original" | "derived";
                original_version_id: string;
                original_sha256: string;
                recipe_sha256: string | null;
                artifact_key: string;
                lot_id: string;
                lot_label: string;
                evidence_label: string;
                destination: "stock_attachment";
              }
            ]
          | [
              {
                version_id: string;
                evidence_id: string;
                blob_sha256: string;
                byte_size: string;
                media_type: "image/jpeg" | "image/png" | "application/pdf";
                kind: "original" | "derived";
                original_version_id: string;
                original_sha256: string;
                recipe_sha256: string | null;
                artifact_key: string;
                lot_id: string;
                lot_label: string;
                evidence_label: string;
                destination: "stock_attachment";
              },
              {
                version_id: string;
                evidence_id: string;
                blob_sha256: string;
                byte_size: string;
                media_type: "image/jpeg" | "image/png" | "application/pdf";
                kind: "original" | "derived";
                original_version_id: string;
                original_sha256: string;
                recipe_sha256: string | null;
                artifact_key: string;
                lot_id: string;
                lot_label: string;
                evidence_label: string;
                destination: "stock_attachment";
              },
              {
                version_id: string;
                evidence_id: string;
                blob_sha256: string;
                byte_size: string;
                media_type: "image/jpeg" | "image/png" | "application/pdf";
                kind: "original" | "derived";
                original_version_id: string;
                original_sha256: string;
                recipe_sha256: string | null;
                artifact_key: string;
                lot_id: string;
                lot_label: string;
                evidence_label: string;
                destination: "stock_attachment";
              },
              {
                version_id: string;
                evidence_id: string;
                blob_sha256: string;
                byte_size: string;
                media_type: "image/jpeg" | "image/png" | "application/pdf";
                kind: "original" | "derived";
                original_version_id: string;
                original_sha256: string;
                recipe_sha256: string | null;
                artifact_key: string;
                lot_id: string;
                lot_label: string;
                evidence_label: string;
                destination: "stock_attachment";
              },
              {
                version_id: string;
                evidence_id: string;
                blob_sha256: string;
                byte_size: string;
                media_type: "image/jpeg" | "image/png" | "application/pdf";
                kind: "original" | "derived";
                original_version_id: string;
                original_sha256: string;
                recipe_sha256: string | null;
                artifact_key: string;
                lot_id: string;
                lot_label: string;
                evidence_label: string;
                destination: "stock_attachment";
              },
              {
                version_id: string;
                evidence_id: string;
                blob_sha256: string;
                byte_size: string;
                media_type: "image/jpeg" | "image/png" | "application/pdf";
                kind: "original" | "derived";
                original_version_id: string;
                original_sha256: string;
                recipe_sha256: string | null;
                artifact_key: string;
                lot_id: string;
                lot_label: string;
                evidence_label: string;
                destination: "stock_attachment";
              },
              {
                version_id: string;
                evidence_id: string;
                blob_sha256: string;
                byte_size: string;
                media_type: "image/jpeg" | "image/png" | "application/pdf";
                kind: "original" | "derived";
                original_version_id: string;
                original_sha256: string;
                recipe_sha256: string | null;
                artifact_key: string;
                lot_id: string;
                lot_label: string;
                evidence_label: string;
                destination: "stock_attachment";
              },
              {
                version_id: string;
                evidence_id: string;
                blob_sha256: string;
                byte_size: string;
                media_type: "image/jpeg" | "image/png" | "application/pdf";
                kind: "original" | "derived";
                original_version_id: string;
                original_sha256: string;
                recipe_sha256: string | null;
                artifact_key: string;
                lot_id: string;
                lot_label: string;
                evidence_label: string;
                destination: "stock_attachment";
              },
              {
                version_id: string;
                evidence_id: string;
                blob_sha256: string;
                byte_size: string;
                media_type: "image/jpeg" | "image/png" | "application/pdf";
                kind: "original" | "derived";
                original_version_id: string;
                original_sha256: string;
                recipe_sha256: string | null;
                artifact_key: string;
                lot_id: string;
                lot_label: string;
                evidence_label: string;
                destination: "stock_attachment";
              }
            ]
          | [
              {
                version_id: string;
                evidence_id: string;
                blob_sha256: string;
                byte_size: string;
                media_type: "image/jpeg" | "image/png" | "application/pdf";
                kind: "original" | "derived";
                original_version_id: string;
                original_sha256: string;
                recipe_sha256: string | null;
                artifact_key: string;
                lot_id: string;
                lot_label: string;
                evidence_label: string;
                destination: "stock_attachment";
              },
              {
                version_id: string;
                evidence_id: string;
                blob_sha256: string;
                byte_size: string;
                media_type: "image/jpeg" | "image/png" | "application/pdf";
                kind: "original" | "derived";
                original_version_id: string;
                original_sha256: string;
                recipe_sha256: string | null;
                artifact_key: string;
                lot_id: string;
                lot_label: string;
                evidence_label: string;
                destination: "stock_attachment";
              },
              {
                version_id: string;
                evidence_id: string;
                blob_sha256: string;
                byte_size: string;
                media_type: "image/jpeg" | "image/png" | "application/pdf";
                kind: "original" | "derived";
                original_version_id: string;
                original_sha256: string;
                recipe_sha256: string | null;
                artifact_key: string;
                lot_id: string;
                lot_label: string;
                evidence_label: string;
                destination: "stock_attachment";
              },
              {
                version_id: string;
                evidence_id: string;
                blob_sha256: string;
                byte_size: string;
                media_type: "image/jpeg" | "image/png" | "application/pdf";
                kind: "original" | "derived";
                original_version_id: string;
                original_sha256: string;
                recipe_sha256: string | null;
                artifact_key: string;
                lot_id: string;
                lot_label: string;
                evidence_label: string;
                destination: "stock_attachment";
              },
              {
                version_id: string;
                evidence_id: string;
                blob_sha256: string;
                byte_size: string;
                media_type: "image/jpeg" | "image/png" | "application/pdf";
                kind: "original" | "derived";
                original_version_id: string;
                original_sha256: string;
                recipe_sha256: string | null;
                artifact_key: string;
                lot_id: string;
                lot_label: string;
                evidence_label: string;
                destination: "stock_attachment";
              },
              {
                version_id: string;
                evidence_id: string;
                blob_sha256: string;
                byte_size: string;
                media_type: "image/jpeg" | "image/png" | "application/pdf";
                kind: "original" | "derived";
                original_version_id: string;
                original_sha256: string;
                recipe_sha256: string | null;
                artifact_key: string;
                lot_id: string;
                lot_label: string;
                evidence_label: string;
                destination: "stock_attachment";
              },
              {
                version_id: string;
                evidence_id: string;
                blob_sha256: string;
                byte_size: string;
                media_type: "image/jpeg" | "image/png" | "application/pdf";
                kind: "original" | "derived";
                original_version_id: string;
                original_sha256: string;
                recipe_sha256: string | null;
                artifact_key: string;
                lot_id: string;
                lot_label: string;
                evidence_label: string;
                destination: "stock_attachment";
              },
              {
                version_id: string;
                evidence_id: string;
                blob_sha256: string;
                byte_size: string;
                media_type: "image/jpeg" | "image/png" | "application/pdf";
                kind: "original" | "derived";
                original_version_id: string;
                original_sha256: string;
                recipe_sha256: string | null;
                artifact_key: string;
                lot_id: string;
                lot_label: string;
                evidence_label: string;
                destination: "stock_attachment";
              },
              {
                version_id: string;
                evidence_id: string;
                blob_sha256: string;
                byte_size: string;
                media_type: "image/jpeg" | "image/png" | "application/pdf";
                kind: "original" | "derived";
                original_version_id: string;
                original_sha256: string;
                recipe_sha256: string | null;
                artifact_key: string;
                lot_id: string;
                lot_label: string;
                evidence_label: string;
                destination: "stock_attachment";
              },
              {
                version_id: string;
                evidence_id: string;
                blob_sha256: string;
                byte_size: string;
                media_type: "image/jpeg" | "image/png" | "application/pdf";
                kind: "original" | "derived";
                original_version_id: string;
                original_sha256: string;
                recipe_sha256: string | null;
                artifact_key: string;
                lot_id: string;
                lot_label: string;
                evidence_label: string;
                destination: "stock_attachment";
              }
            ];
        /**
         * @maxItems 64
         */
        evidence?: {
          version_id: string;
          evidence_id: string;
          blob_sha256: string;
          byte_size: string;
          media_type: "image/jpeg" | "image/png" | "application/pdf";
          kind: "original" | "derived";
          original_version_id: string;
          original_sha256: string;
          recipe_sha256: string | null;
        }[];
        media_inputs_sha256?: string;
        /**
         * @minItems 1
         * @maxItems 10
         */
        effects:
          | [
              {
                lot_id: string;
                lot_label: string;
                part_id: string;
                part_label: string;
                quantity: string;
                location_id: string | null;
                location_label: string;
                contribution_key: string;
                barcode: string;
              }
            ]
          | [
              {
                lot_id: string;
                lot_label: string;
                part_id: string;
                part_label: string;
                quantity: string;
                location_id: string | null;
                location_label: string;
                contribution_key: string;
                barcode: string;
              },
              {
                lot_id: string;
                lot_label: string;
                part_id: string;
                part_label: string;
                quantity: string;
                location_id: string | null;
                location_label: string;
                contribution_key: string;
                barcode: string;
              }
            ]
          | [
              {
                lot_id: string;
                lot_label: string;
                part_id: string;
                part_label: string;
                quantity: string;
                location_id: string | null;
                location_label: string;
                contribution_key: string;
                barcode: string;
              },
              {
                lot_id: string;
                lot_label: string;
                part_id: string;
                part_label: string;
                quantity: string;
                location_id: string | null;
                location_label: string;
                contribution_key: string;
                barcode: string;
              },
              {
                lot_id: string;
                lot_label: string;
                part_id: string;
                part_label: string;
                quantity: string;
                location_id: string | null;
                location_label: string;
                contribution_key: string;
                barcode: string;
              }
            ]
          | [
              {
                lot_id: string;
                lot_label: string;
                part_id: string;
                part_label: string;
                quantity: string;
                location_id: string | null;
                location_label: string;
                contribution_key: string;
                barcode: string;
              },
              {
                lot_id: string;
                lot_label: string;
                part_id: string;
                part_label: string;
                quantity: string;
                location_id: string | null;
                location_label: string;
                contribution_key: string;
                barcode: string;
              },
              {
                lot_id: string;
                lot_label: string;
                part_id: string;
                part_label: string;
                quantity: string;
                location_id: string | null;
                location_label: string;
                contribution_key: string;
                barcode: string;
              },
              {
                lot_id: string;
                lot_label: string;
                part_id: string;
                part_label: string;
                quantity: string;
                location_id: string | null;
                location_label: string;
                contribution_key: string;
                barcode: string;
              }
            ]
          | [
              {
                lot_id: string;
                lot_label: string;
                part_id: string;
                part_label: string;
                quantity: string;
                location_id: string | null;
                location_label: string;
                contribution_key: string;
                barcode: string;
              },
              {
                lot_id: string;
                lot_label: string;
                part_id: string;
                part_label: string;
                quantity: string;
                location_id: string | null;
                location_label: string;
                contribution_key: string;
                barcode: string;
              },
              {
                lot_id: string;
                lot_label: string;
                part_id: string;
                part_label: string;
                quantity: string;
                location_id: string | null;
                location_label: string;
                contribution_key: string;
                barcode: string;
              },
              {
                lot_id: string;
                lot_label: string;
                part_id: string;
                part_label: string;
                quantity: string;
                location_id: string | null;
                location_label: string;
                contribution_key: string;
                barcode: string;
              },
              {
                lot_id: string;
                lot_label: string;
                part_id: string;
                part_label: string;
                quantity: string;
                location_id: string | null;
                location_label: string;
                contribution_key: string;
                barcode: string;
              }
            ]
          | [
              {
                lot_id: string;
                lot_label: string;
                part_id: string;
                part_label: string;
                quantity: string;
                location_id: string | null;
                location_label: string;
                contribution_key: string;
                barcode: string;
              },
              {
                lot_id: string;
                lot_label: string;
                part_id: string;
                part_label: string;
                quantity: string;
                location_id: string | null;
                location_label: string;
                contribution_key: string;
                barcode: string;
              },
              {
                lot_id: string;
                lot_label: string;
                part_id: string;
                part_label: string;
                quantity: string;
                location_id: string | null;
                location_label: string;
                contribution_key: string;
                barcode: string;
              },
              {
                lot_id: string;
                lot_label: string;
                part_id: string;
                part_label: string;
                quantity: string;
                location_id: string | null;
                location_label: string;
                contribution_key: string;
                barcode: string;
              },
              {
                lot_id: string;
                lot_label: string;
                part_id: string;
                part_label: string;
                quantity: string;
                location_id: string | null;
                location_label: string;
                contribution_key: string;
                barcode: string;
              },
              {
                lot_id: string;
                lot_label: string;
                part_id: string;
                part_label: string;
                quantity: string;
                location_id: string | null;
                location_label: string;
                contribution_key: string;
                barcode: string;
              }
            ]
          | [
              {
                lot_id: string;
                lot_label: string;
                part_id: string;
                part_label: string;
                quantity: string;
                location_id: string | null;
                location_label: string;
                contribution_key: string;
                barcode: string;
              },
              {
                lot_id: string;
                lot_label: string;
                part_id: string;
                part_label: string;
                quantity: string;
                location_id: string | null;
                location_label: string;
                contribution_key: string;
                barcode: string;
              },
              {
                lot_id: string;
                lot_label: string;
                part_id: string;
                part_label: string;
                quantity: string;
                location_id: string | null;
                location_label: string;
                contribution_key: string;
                barcode: string;
              },
              {
                lot_id: string;
                lot_label: string;
                part_id: string;
                part_label: string;
                quantity: string;
                location_id: string | null;
                location_label: string;
                contribution_key: string;
                barcode: string;
              },
              {
                lot_id: string;
                lot_label: string;
                part_id: string;
                part_label: string;
                quantity: string;
                location_id: string | null;
                location_label: string;
                contribution_key: string;
                barcode: string;
              },
              {
                lot_id: string;
                lot_label: string;
                part_id: string;
                part_label: string;
                quantity: string;
                location_id: string | null;
                location_label: string;
                contribution_key: string;
                barcode: string;
              },
              {
                lot_id: string;
                lot_label: string;
                part_id: string;
                part_label: string;
                quantity: string;
                location_id: string | null;
                location_label: string;
                contribution_key: string;
                barcode: string;
              }
            ]
          | [
              {
                lot_id: string;
                lot_label: string;
                part_id: string;
                part_label: string;
                quantity: string;
                location_id: string | null;
                location_label: string;
                contribution_key: string;
                barcode: string;
              },
              {
                lot_id: string;
                lot_label: string;
                part_id: string;
                part_label: string;
                quantity: string;
                location_id: string | null;
                location_label: string;
                contribution_key: string;
                barcode: string;
              },
              {
                lot_id: string;
                lot_label: string;
                part_id: string;
                part_label: string;
                quantity: string;
                location_id: string | null;
                location_label: string;
                contribution_key: string;
                barcode: string;
              },
              {
                lot_id: string;
                lot_label: string;
                part_id: string;
                part_label: string;
                quantity: string;
                location_id: string | null;
                location_label: string;
                contribution_key: string;
                barcode: string;
              },
              {
                lot_id: string;
                lot_label: string;
                part_id: string;
                part_label: string;
                quantity: string;
                location_id: string | null;
                location_label: string;
                contribution_key: string;
                barcode: string;
              },
              {
                lot_id: string;
                lot_label: string;
                part_id: string;
                part_label: string;
                quantity: string;
                location_id: string | null;
                location_label: string;
                contribution_key: string;
                barcode: string;
              },
              {
                lot_id: string;
                lot_label: string;
                part_id: string;
                part_label: string;
                quantity: string;
                location_id: string | null;
                location_label: string;
                contribution_key: string;
                barcode: string;
              },
              {
                lot_id: string;
                lot_label: string;
                part_id: string;
                part_label: string;
                quantity: string;
                location_id: string | null;
                location_label: string;
                contribution_key: string;
                barcode: string;
              }
            ]
          | [
              {
                lot_id: string;
                lot_label: string;
                part_id: string;
                part_label: string;
                quantity: string;
                location_id: string | null;
                location_label: string;
                contribution_key: string;
                barcode: string;
              },
              {
                lot_id: string;
                lot_label: string;
                part_id: string;
                part_label: string;
                quantity: string;
                location_id: string | null;
                location_label: string;
                contribution_key: string;
                barcode: string;
              },
              {
                lot_id: string;
                lot_label: string;
                part_id: string;
                part_label: string;
                quantity: string;
                location_id: string | null;
                location_label: string;
                contribution_key: string;
                barcode: string;
              },
              {
                lot_id: string;
                lot_label: string;
                part_id: string;
                part_label: string;
                quantity: string;
                location_id: string | null;
                location_label: string;
                contribution_key: string;
                barcode: string;
              },
              {
                lot_id: string;
                lot_label: string;
                part_id: string;
                part_label: string;
                quantity: string;
                location_id: string | null;
                location_label: string;
                contribution_key: string;
                barcode: string;
              },
              {
                lot_id: string;
                lot_label: string;
                part_id: string;
                part_label: string;
                quantity: string;
                location_id: string | null;
                location_label: string;
                contribution_key: string;
                barcode: string;
              },
              {
                lot_id: string;
                lot_label: string;
                part_id: string;
                part_label: string;
                quantity: string;
                location_id: string | null;
                location_label: string;
                contribution_key: string;
                barcode: string;
              },
              {
                lot_id: string;
                lot_label: string;
                part_id: string;
                part_label: string;
                quantity: string;
                location_id: string | null;
                location_label: string;
                contribution_key: string;
                barcode: string;
              },
              {
                lot_id: string;
                lot_label: string;
                part_id: string;
                part_label: string;
                quantity: string;
                location_id: string | null;
                location_label: string;
                contribution_key: string;
                barcode: string;
              }
            ]
          | [
              {
                lot_id: string;
                lot_label: string;
                part_id: string;
                part_label: string;
                quantity: string;
                location_id: string | null;
                location_label: string;
                contribution_key: string;
                barcode: string;
              },
              {
                lot_id: string;
                lot_label: string;
                part_id: string;
                part_label: string;
                quantity: string;
                location_id: string | null;
                location_label: string;
                contribution_key: string;
                barcode: string;
              },
              {
                lot_id: string;
                lot_label: string;
                part_id: string;
                part_label: string;
                quantity: string;
                location_id: string | null;
                location_label: string;
                contribution_key: string;
                barcode: string;
              },
              {
                lot_id: string;
                lot_label: string;
                part_id: string;
                part_label: string;
                quantity: string;
                location_id: string | null;
                location_label: string;
                contribution_key: string;
                barcode: string;
              },
              {
                lot_id: string;
                lot_label: string;
                part_id: string;
                part_label: string;
                quantity: string;
                location_id: string | null;
                location_label: string;
                contribution_key: string;
                barcode: string;
              },
              {
                lot_id: string;
                lot_label: string;
                part_id: string;
                part_label: string;
                quantity: string;
                location_id: string | null;
                location_label: string;
                contribution_key: string;
                barcode: string;
              },
              {
                lot_id: string;
                lot_label: string;
                part_id: string;
                part_label: string;
                quantity: string;
                location_id: string | null;
                location_label: string;
                contribution_key: string;
                barcode: string;
              },
              {
                lot_id: string;
                lot_label: string;
                part_id: string;
                part_label: string;
                quantity: string;
                location_id: string | null;
                location_label: string;
                contribution_key: string;
                barcode: string;
              },
              {
                lot_id: string;
                lot_label: string;
                part_id: string;
                part_label: string;
                quantity: string;
                location_id: string | null;
                location_label: string;
                contribution_key: string;
                barcode: string;
              },
              {
                lot_id: string;
                lot_label: string;
                part_id: string;
                part_label: string;
                quantity: string;
                location_id: string | null;
                location_label: string;
                contribution_key: string;
                barcode: string;
              }
            ];
      };
    }
  | {
      status: "blocked";
      /**
       * @minItems 1
       * @maxItems 100
       */
      issues: [
        {
          code: string;
          message: string;
          lot_id: string | null;
          run_id: string | null;
        },
        ...{
          code: string;
          message: string;
          lot_id: string | null;
          run_id: string | null;
        }[]
      ];
    };

export interface ManualReviewResult {
  reviewed_subject_ids: string[];
  cursor: {
    stream_id: string;
    sequence: string;
  };
}

export interface ManualAccepted {
  run_id: string;
  approval_id: string;
  preparation_id: string;
}

export interface ManualRunCommand {
  expected_run_revision: string;
}

export interface ManualRecoveryCommand {
  expected_run_revision: string;
  /**
   * @minItems 1
   * @maxItems 10
   */
  operation_keys:
    | [string]
    | [string, string]
    | [string, string, string]
    | [string, string, string, string]
    | [string, string, string, string, string]
    | [string, string, string, string, string, string]
    | [string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string];
}

export interface ManualRun {
  run_id: string;
  approval_id: string;
  preparation_id: string;
  batch_id: string;
  revision: string;
  round_number: string;
  state: "queued" | "running" | "stopping" | "settled_complete" | "settled_incomplete" | "recovery_required";
  effect_certainty: "none" | "confirmed" | "unknown" | "mixed";
  confirmed_stock_ids: string[];
  attributed_stock_ids: string[];
  cancellation_requested: boolean;
  dispatch_state: "not_requested" | "queued" | "running" | "finished" | "interrupted";
  /**
   * @maxItems 10
   */
  attachments?:
    | []
    | [
        {
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          version_id: string;
          blob_sha256: string;
          byte_size: string;
          kind: "original" | "derived";
          certainty: "none" | "unknown" | "confirmed";
          remote_pk: string | null;
          verification: "matches" | "missing_or_changed" | "unavailable" | null;
          recovery_action: "repair_attachment" | "verify_attachment" | null;
        }
      ]
    | [
        {
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          version_id: string;
          blob_sha256: string;
          byte_size: string;
          kind: "original" | "derived";
          certainty: "none" | "unknown" | "confirmed";
          remote_pk: string | null;
          verification: "matches" | "missing_or_changed" | "unavailable" | null;
          recovery_action: "repair_attachment" | "verify_attachment" | null;
        },
        {
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          version_id: string;
          blob_sha256: string;
          byte_size: string;
          kind: "original" | "derived";
          certainty: "none" | "unknown" | "confirmed";
          remote_pk: string | null;
          verification: "matches" | "missing_or_changed" | "unavailable" | null;
          recovery_action: "repair_attachment" | "verify_attachment" | null;
        }
      ]
    | [
        {
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          version_id: string;
          blob_sha256: string;
          byte_size: string;
          kind: "original" | "derived";
          certainty: "none" | "unknown" | "confirmed";
          remote_pk: string | null;
          verification: "matches" | "missing_or_changed" | "unavailable" | null;
          recovery_action: "repair_attachment" | "verify_attachment" | null;
        },
        {
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          version_id: string;
          blob_sha256: string;
          byte_size: string;
          kind: "original" | "derived";
          certainty: "none" | "unknown" | "confirmed";
          remote_pk: string | null;
          verification: "matches" | "missing_or_changed" | "unavailable" | null;
          recovery_action: "repair_attachment" | "verify_attachment" | null;
        },
        {
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          version_id: string;
          blob_sha256: string;
          byte_size: string;
          kind: "original" | "derived";
          certainty: "none" | "unknown" | "confirmed";
          remote_pk: string | null;
          verification: "matches" | "missing_or_changed" | "unavailable" | null;
          recovery_action: "repair_attachment" | "verify_attachment" | null;
        }
      ]
    | [
        {
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          version_id: string;
          blob_sha256: string;
          byte_size: string;
          kind: "original" | "derived";
          certainty: "none" | "unknown" | "confirmed";
          remote_pk: string | null;
          verification: "matches" | "missing_or_changed" | "unavailable" | null;
          recovery_action: "repair_attachment" | "verify_attachment" | null;
        },
        {
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          version_id: string;
          blob_sha256: string;
          byte_size: string;
          kind: "original" | "derived";
          certainty: "none" | "unknown" | "confirmed";
          remote_pk: string | null;
          verification: "matches" | "missing_or_changed" | "unavailable" | null;
          recovery_action: "repair_attachment" | "verify_attachment" | null;
        },
        {
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          version_id: string;
          blob_sha256: string;
          byte_size: string;
          kind: "original" | "derived";
          certainty: "none" | "unknown" | "confirmed";
          remote_pk: string | null;
          verification: "matches" | "missing_or_changed" | "unavailable" | null;
          recovery_action: "repair_attachment" | "verify_attachment" | null;
        },
        {
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          version_id: string;
          blob_sha256: string;
          byte_size: string;
          kind: "original" | "derived";
          certainty: "none" | "unknown" | "confirmed";
          remote_pk: string | null;
          verification: "matches" | "missing_or_changed" | "unavailable" | null;
          recovery_action: "repair_attachment" | "verify_attachment" | null;
        }
      ]
    | [
        {
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          version_id: string;
          blob_sha256: string;
          byte_size: string;
          kind: "original" | "derived";
          certainty: "none" | "unknown" | "confirmed";
          remote_pk: string | null;
          verification: "matches" | "missing_or_changed" | "unavailable" | null;
          recovery_action: "repair_attachment" | "verify_attachment" | null;
        },
        {
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          version_id: string;
          blob_sha256: string;
          byte_size: string;
          kind: "original" | "derived";
          certainty: "none" | "unknown" | "confirmed";
          remote_pk: string | null;
          verification: "matches" | "missing_or_changed" | "unavailable" | null;
          recovery_action: "repair_attachment" | "verify_attachment" | null;
        },
        {
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          version_id: string;
          blob_sha256: string;
          byte_size: string;
          kind: "original" | "derived";
          certainty: "none" | "unknown" | "confirmed";
          remote_pk: string | null;
          verification: "matches" | "missing_or_changed" | "unavailable" | null;
          recovery_action: "repair_attachment" | "verify_attachment" | null;
        },
        {
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          version_id: string;
          blob_sha256: string;
          byte_size: string;
          kind: "original" | "derived";
          certainty: "none" | "unknown" | "confirmed";
          remote_pk: string | null;
          verification: "matches" | "missing_or_changed" | "unavailable" | null;
          recovery_action: "repair_attachment" | "verify_attachment" | null;
        },
        {
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          version_id: string;
          blob_sha256: string;
          byte_size: string;
          kind: "original" | "derived";
          certainty: "none" | "unknown" | "confirmed";
          remote_pk: string | null;
          verification: "matches" | "missing_or_changed" | "unavailable" | null;
          recovery_action: "repair_attachment" | "verify_attachment" | null;
        }
      ]
    | [
        {
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          version_id: string;
          blob_sha256: string;
          byte_size: string;
          kind: "original" | "derived";
          certainty: "none" | "unknown" | "confirmed";
          remote_pk: string | null;
          verification: "matches" | "missing_or_changed" | "unavailable" | null;
          recovery_action: "repair_attachment" | "verify_attachment" | null;
        },
        {
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          version_id: string;
          blob_sha256: string;
          byte_size: string;
          kind: "original" | "derived";
          certainty: "none" | "unknown" | "confirmed";
          remote_pk: string | null;
          verification: "matches" | "missing_or_changed" | "unavailable" | null;
          recovery_action: "repair_attachment" | "verify_attachment" | null;
        },
        {
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          version_id: string;
          blob_sha256: string;
          byte_size: string;
          kind: "original" | "derived";
          certainty: "none" | "unknown" | "confirmed";
          remote_pk: string | null;
          verification: "matches" | "missing_or_changed" | "unavailable" | null;
          recovery_action: "repair_attachment" | "verify_attachment" | null;
        },
        {
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          version_id: string;
          blob_sha256: string;
          byte_size: string;
          kind: "original" | "derived";
          certainty: "none" | "unknown" | "confirmed";
          remote_pk: string | null;
          verification: "matches" | "missing_or_changed" | "unavailable" | null;
          recovery_action: "repair_attachment" | "verify_attachment" | null;
        },
        {
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          version_id: string;
          blob_sha256: string;
          byte_size: string;
          kind: "original" | "derived";
          certainty: "none" | "unknown" | "confirmed";
          remote_pk: string | null;
          verification: "matches" | "missing_or_changed" | "unavailable" | null;
          recovery_action: "repair_attachment" | "verify_attachment" | null;
        },
        {
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          version_id: string;
          blob_sha256: string;
          byte_size: string;
          kind: "original" | "derived";
          certainty: "none" | "unknown" | "confirmed";
          remote_pk: string | null;
          verification: "matches" | "missing_or_changed" | "unavailable" | null;
          recovery_action: "repair_attachment" | "verify_attachment" | null;
        }
      ]
    | [
        {
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          version_id: string;
          blob_sha256: string;
          byte_size: string;
          kind: "original" | "derived";
          certainty: "none" | "unknown" | "confirmed";
          remote_pk: string | null;
          verification: "matches" | "missing_or_changed" | "unavailable" | null;
          recovery_action: "repair_attachment" | "verify_attachment" | null;
        },
        {
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          version_id: string;
          blob_sha256: string;
          byte_size: string;
          kind: "original" | "derived";
          certainty: "none" | "unknown" | "confirmed";
          remote_pk: string | null;
          verification: "matches" | "missing_or_changed" | "unavailable" | null;
          recovery_action: "repair_attachment" | "verify_attachment" | null;
        },
        {
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          version_id: string;
          blob_sha256: string;
          byte_size: string;
          kind: "original" | "derived";
          certainty: "none" | "unknown" | "confirmed";
          remote_pk: string | null;
          verification: "matches" | "missing_or_changed" | "unavailable" | null;
          recovery_action: "repair_attachment" | "verify_attachment" | null;
        },
        {
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          version_id: string;
          blob_sha256: string;
          byte_size: string;
          kind: "original" | "derived";
          certainty: "none" | "unknown" | "confirmed";
          remote_pk: string | null;
          verification: "matches" | "missing_or_changed" | "unavailable" | null;
          recovery_action: "repair_attachment" | "verify_attachment" | null;
        },
        {
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          version_id: string;
          blob_sha256: string;
          byte_size: string;
          kind: "original" | "derived";
          certainty: "none" | "unknown" | "confirmed";
          remote_pk: string | null;
          verification: "matches" | "missing_or_changed" | "unavailable" | null;
          recovery_action: "repair_attachment" | "verify_attachment" | null;
        },
        {
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          version_id: string;
          blob_sha256: string;
          byte_size: string;
          kind: "original" | "derived";
          certainty: "none" | "unknown" | "confirmed";
          remote_pk: string | null;
          verification: "matches" | "missing_or_changed" | "unavailable" | null;
          recovery_action: "repair_attachment" | "verify_attachment" | null;
        },
        {
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          version_id: string;
          blob_sha256: string;
          byte_size: string;
          kind: "original" | "derived";
          certainty: "none" | "unknown" | "confirmed";
          remote_pk: string | null;
          verification: "matches" | "missing_or_changed" | "unavailable" | null;
          recovery_action: "repair_attachment" | "verify_attachment" | null;
        }
      ]
    | [
        {
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          version_id: string;
          blob_sha256: string;
          byte_size: string;
          kind: "original" | "derived";
          certainty: "none" | "unknown" | "confirmed";
          remote_pk: string | null;
          verification: "matches" | "missing_or_changed" | "unavailable" | null;
          recovery_action: "repair_attachment" | "verify_attachment" | null;
        },
        {
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          version_id: string;
          blob_sha256: string;
          byte_size: string;
          kind: "original" | "derived";
          certainty: "none" | "unknown" | "confirmed";
          remote_pk: string | null;
          verification: "matches" | "missing_or_changed" | "unavailable" | null;
          recovery_action: "repair_attachment" | "verify_attachment" | null;
        },
        {
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          version_id: string;
          blob_sha256: string;
          byte_size: string;
          kind: "original" | "derived";
          certainty: "none" | "unknown" | "confirmed";
          remote_pk: string | null;
          verification: "matches" | "missing_or_changed" | "unavailable" | null;
          recovery_action: "repair_attachment" | "verify_attachment" | null;
        },
        {
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          version_id: string;
          blob_sha256: string;
          byte_size: string;
          kind: "original" | "derived";
          certainty: "none" | "unknown" | "confirmed";
          remote_pk: string | null;
          verification: "matches" | "missing_or_changed" | "unavailable" | null;
          recovery_action: "repair_attachment" | "verify_attachment" | null;
        },
        {
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          version_id: string;
          blob_sha256: string;
          byte_size: string;
          kind: "original" | "derived";
          certainty: "none" | "unknown" | "confirmed";
          remote_pk: string | null;
          verification: "matches" | "missing_or_changed" | "unavailable" | null;
          recovery_action: "repair_attachment" | "verify_attachment" | null;
        },
        {
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          version_id: string;
          blob_sha256: string;
          byte_size: string;
          kind: "original" | "derived";
          certainty: "none" | "unknown" | "confirmed";
          remote_pk: string | null;
          verification: "matches" | "missing_or_changed" | "unavailable" | null;
          recovery_action: "repair_attachment" | "verify_attachment" | null;
        },
        {
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          version_id: string;
          blob_sha256: string;
          byte_size: string;
          kind: "original" | "derived";
          certainty: "none" | "unknown" | "confirmed";
          remote_pk: string | null;
          verification: "matches" | "missing_or_changed" | "unavailable" | null;
          recovery_action: "repair_attachment" | "verify_attachment" | null;
        },
        {
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          version_id: string;
          blob_sha256: string;
          byte_size: string;
          kind: "original" | "derived";
          certainty: "none" | "unknown" | "confirmed";
          remote_pk: string | null;
          verification: "matches" | "missing_or_changed" | "unavailable" | null;
          recovery_action: "repair_attachment" | "verify_attachment" | null;
        }
      ]
    | [
        {
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          version_id: string;
          blob_sha256: string;
          byte_size: string;
          kind: "original" | "derived";
          certainty: "none" | "unknown" | "confirmed";
          remote_pk: string | null;
          verification: "matches" | "missing_or_changed" | "unavailable" | null;
          recovery_action: "repair_attachment" | "verify_attachment" | null;
        },
        {
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          version_id: string;
          blob_sha256: string;
          byte_size: string;
          kind: "original" | "derived";
          certainty: "none" | "unknown" | "confirmed";
          remote_pk: string | null;
          verification: "matches" | "missing_or_changed" | "unavailable" | null;
          recovery_action: "repair_attachment" | "verify_attachment" | null;
        },
        {
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          version_id: string;
          blob_sha256: string;
          byte_size: string;
          kind: "original" | "derived";
          certainty: "none" | "unknown" | "confirmed";
          remote_pk: string | null;
          verification: "matches" | "missing_or_changed" | "unavailable" | null;
          recovery_action: "repair_attachment" | "verify_attachment" | null;
        },
        {
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          version_id: string;
          blob_sha256: string;
          byte_size: string;
          kind: "original" | "derived";
          certainty: "none" | "unknown" | "confirmed";
          remote_pk: string | null;
          verification: "matches" | "missing_or_changed" | "unavailable" | null;
          recovery_action: "repair_attachment" | "verify_attachment" | null;
        },
        {
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          version_id: string;
          blob_sha256: string;
          byte_size: string;
          kind: "original" | "derived";
          certainty: "none" | "unknown" | "confirmed";
          remote_pk: string | null;
          verification: "matches" | "missing_or_changed" | "unavailable" | null;
          recovery_action: "repair_attachment" | "verify_attachment" | null;
        },
        {
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          version_id: string;
          blob_sha256: string;
          byte_size: string;
          kind: "original" | "derived";
          certainty: "none" | "unknown" | "confirmed";
          remote_pk: string | null;
          verification: "matches" | "missing_or_changed" | "unavailable" | null;
          recovery_action: "repair_attachment" | "verify_attachment" | null;
        },
        {
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          version_id: string;
          blob_sha256: string;
          byte_size: string;
          kind: "original" | "derived";
          certainty: "none" | "unknown" | "confirmed";
          remote_pk: string | null;
          verification: "matches" | "missing_or_changed" | "unavailable" | null;
          recovery_action: "repair_attachment" | "verify_attachment" | null;
        },
        {
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          version_id: string;
          blob_sha256: string;
          byte_size: string;
          kind: "original" | "derived";
          certainty: "none" | "unknown" | "confirmed";
          remote_pk: string | null;
          verification: "matches" | "missing_or_changed" | "unavailable" | null;
          recovery_action: "repair_attachment" | "verify_attachment" | null;
        },
        {
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          version_id: string;
          blob_sha256: string;
          byte_size: string;
          kind: "original" | "derived";
          certainty: "none" | "unknown" | "confirmed";
          remote_pk: string | null;
          verification: "matches" | "missing_or_changed" | "unavailable" | null;
          recovery_action: "repair_attachment" | "verify_attachment" | null;
        }
      ]
    | [
        {
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          version_id: string;
          blob_sha256: string;
          byte_size: string;
          kind: "original" | "derived";
          certainty: "none" | "unknown" | "confirmed";
          remote_pk: string | null;
          verification: "matches" | "missing_or_changed" | "unavailable" | null;
          recovery_action: "repair_attachment" | "verify_attachment" | null;
        },
        {
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          version_id: string;
          blob_sha256: string;
          byte_size: string;
          kind: "original" | "derived";
          certainty: "none" | "unknown" | "confirmed";
          remote_pk: string | null;
          verification: "matches" | "missing_or_changed" | "unavailable" | null;
          recovery_action: "repair_attachment" | "verify_attachment" | null;
        },
        {
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          version_id: string;
          blob_sha256: string;
          byte_size: string;
          kind: "original" | "derived";
          certainty: "none" | "unknown" | "confirmed";
          remote_pk: string | null;
          verification: "matches" | "missing_or_changed" | "unavailable" | null;
          recovery_action: "repair_attachment" | "verify_attachment" | null;
        },
        {
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          version_id: string;
          blob_sha256: string;
          byte_size: string;
          kind: "original" | "derived";
          certainty: "none" | "unknown" | "confirmed";
          remote_pk: string | null;
          verification: "matches" | "missing_or_changed" | "unavailable" | null;
          recovery_action: "repair_attachment" | "verify_attachment" | null;
        },
        {
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          version_id: string;
          blob_sha256: string;
          byte_size: string;
          kind: "original" | "derived";
          certainty: "none" | "unknown" | "confirmed";
          remote_pk: string | null;
          verification: "matches" | "missing_or_changed" | "unavailable" | null;
          recovery_action: "repair_attachment" | "verify_attachment" | null;
        },
        {
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          version_id: string;
          blob_sha256: string;
          byte_size: string;
          kind: "original" | "derived";
          certainty: "none" | "unknown" | "confirmed";
          remote_pk: string | null;
          verification: "matches" | "missing_or_changed" | "unavailable" | null;
          recovery_action: "repair_attachment" | "verify_attachment" | null;
        },
        {
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          version_id: string;
          blob_sha256: string;
          byte_size: string;
          kind: "original" | "derived";
          certainty: "none" | "unknown" | "confirmed";
          remote_pk: string | null;
          verification: "matches" | "missing_or_changed" | "unavailable" | null;
          recovery_action: "repair_attachment" | "verify_attachment" | null;
        },
        {
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          version_id: string;
          blob_sha256: string;
          byte_size: string;
          kind: "original" | "derived";
          certainty: "none" | "unknown" | "confirmed";
          remote_pk: string | null;
          verification: "matches" | "missing_or_changed" | "unavailable" | null;
          recovery_action: "repair_attachment" | "verify_attachment" | null;
        },
        {
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          version_id: string;
          blob_sha256: string;
          byte_size: string;
          kind: "original" | "derived";
          certainty: "none" | "unknown" | "confirmed";
          remote_pk: string | null;
          verification: "matches" | "missing_or_changed" | "unavailable" | null;
          recovery_action: "repair_attachment" | "verify_attachment" | null;
        },
        {
          artifact_key: string;
          lot_id: string;
          lot_label: string;
          version_id: string;
          blob_sha256: string;
          byte_size: string;
          kind: "original" | "derived";
          certainty: "none" | "unknown" | "confirmed";
          remote_pk: string | null;
          verification: "matches" | "missing_or_changed" | "unavailable" | null;
          recovery_action: "repair_attachment" | "verify_attachment" | null;
        }
      ];
  operations: {
    operation_key: string;
    lot_id: string;
    lot_label: string;
    quantity: string;
    certainty: "none" | "confirmed" | "unknown";
    remote_pk: string | null;
    recovery_allowed: boolean;
  }[];
  cursor: {
    stream_id: string;
    sequence: string;
  };
}

export interface ManualWorkspace {
  batch_id: string;
  revision: string;
  supported: boolean;
  capability: ("owned-fake-stock/1" | "owned-fake-media/1") | null;
  lots: {
    lot_id: string;
    reviewed: boolean;
    issues: {
      code: string;
      message: string;
      lot_id: string | null;
      run_id: string | null;
    }[];
  }[];
  runs: {
    run_id: string;
    approval_id: string;
    preparation_id: string;
    batch_id: string;
    revision: string;
    round_number: string;
    state: "queued" | "running" | "stopping" | "settled_complete" | "settled_incomplete" | "recovery_required";
    effect_certainty: "none" | "confirmed" | "unknown" | "mixed";
    confirmed_stock_ids: string[];
    attributed_stock_ids: string[];
    cancellation_requested: boolean;
    dispatch_state: "not_requested" | "queued" | "running" | "finished" | "interrupted";
    /**
     * @maxItems 10
     */
    attachments?:
      | []
      | [
          {
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            version_id: string;
            blob_sha256: string;
            byte_size: string;
            kind: "original" | "derived";
            certainty: "none" | "unknown" | "confirmed";
            remote_pk: string | null;
            verification: "matches" | "missing_or_changed" | "unavailable" | null;
            recovery_action: "repair_attachment" | "verify_attachment" | null;
          }
        ]
      | [
          {
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            version_id: string;
            blob_sha256: string;
            byte_size: string;
            kind: "original" | "derived";
            certainty: "none" | "unknown" | "confirmed";
            remote_pk: string | null;
            verification: "matches" | "missing_or_changed" | "unavailable" | null;
            recovery_action: "repair_attachment" | "verify_attachment" | null;
          },
          {
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            version_id: string;
            blob_sha256: string;
            byte_size: string;
            kind: "original" | "derived";
            certainty: "none" | "unknown" | "confirmed";
            remote_pk: string | null;
            verification: "matches" | "missing_or_changed" | "unavailable" | null;
            recovery_action: "repair_attachment" | "verify_attachment" | null;
          }
        ]
      | [
          {
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            version_id: string;
            blob_sha256: string;
            byte_size: string;
            kind: "original" | "derived";
            certainty: "none" | "unknown" | "confirmed";
            remote_pk: string | null;
            verification: "matches" | "missing_or_changed" | "unavailable" | null;
            recovery_action: "repair_attachment" | "verify_attachment" | null;
          },
          {
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            version_id: string;
            blob_sha256: string;
            byte_size: string;
            kind: "original" | "derived";
            certainty: "none" | "unknown" | "confirmed";
            remote_pk: string | null;
            verification: "matches" | "missing_or_changed" | "unavailable" | null;
            recovery_action: "repair_attachment" | "verify_attachment" | null;
          },
          {
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            version_id: string;
            blob_sha256: string;
            byte_size: string;
            kind: "original" | "derived";
            certainty: "none" | "unknown" | "confirmed";
            remote_pk: string | null;
            verification: "matches" | "missing_or_changed" | "unavailable" | null;
            recovery_action: "repair_attachment" | "verify_attachment" | null;
          }
        ]
      | [
          {
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            version_id: string;
            blob_sha256: string;
            byte_size: string;
            kind: "original" | "derived";
            certainty: "none" | "unknown" | "confirmed";
            remote_pk: string | null;
            verification: "matches" | "missing_or_changed" | "unavailable" | null;
            recovery_action: "repair_attachment" | "verify_attachment" | null;
          },
          {
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            version_id: string;
            blob_sha256: string;
            byte_size: string;
            kind: "original" | "derived";
            certainty: "none" | "unknown" | "confirmed";
            remote_pk: string | null;
            verification: "matches" | "missing_or_changed" | "unavailable" | null;
            recovery_action: "repair_attachment" | "verify_attachment" | null;
          },
          {
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            version_id: string;
            blob_sha256: string;
            byte_size: string;
            kind: "original" | "derived";
            certainty: "none" | "unknown" | "confirmed";
            remote_pk: string | null;
            verification: "matches" | "missing_or_changed" | "unavailable" | null;
            recovery_action: "repair_attachment" | "verify_attachment" | null;
          },
          {
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            version_id: string;
            blob_sha256: string;
            byte_size: string;
            kind: "original" | "derived";
            certainty: "none" | "unknown" | "confirmed";
            remote_pk: string | null;
            verification: "matches" | "missing_or_changed" | "unavailable" | null;
            recovery_action: "repair_attachment" | "verify_attachment" | null;
          }
        ]
      | [
          {
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            version_id: string;
            blob_sha256: string;
            byte_size: string;
            kind: "original" | "derived";
            certainty: "none" | "unknown" | "confirmed";
            remote_pk: string | null;
            verification: "matches" | "missing_or_changed" | "unavailable" | null;
            recovery_action: "repair_attachment" | "verify_attachment" | null;
          },
          {
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            version_id: string;
            blob_sha256: string;
            byte_size: string;
            kind: "original" | "derived";
            certainty: "none" | "unknown" | "confirmed";
            remote_pk: string | null;
            verification: "matches" | "missing_or_changed" | "unavailable" | null;
            recovery_action: "repair_attachment" | "verify_attachment" | null;
          },
          {
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            version_id: string;
            blob_sha256: string;
            byte_size: string;
            kind: "original" | "derived";
            certainty: "none" | "unknown" | "confirmed";
            remote_pk: string | null;
            verification: "matches" | "missing_or_changed" | "unavailable" | null;
            recovery_action: "repair_attachment" | "verify_attachment" | null;
          },
          {
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            version_id: string;
            blob_sha256: string;
            byte_size: string;
            kind: "original" | "derived";
            certainty: "none" | "unknown" | "confirmed";
            remote_pk: string | null;
            verification: "matches" | "missing_or_changed" | "unavailable" | null;
            recovery_action: "repair_attachment" | "verify_attachment" | null;
          },
          {
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            version_id: string;
            blob_sha256: string;
            byte_size: string;
            kind: "original" | "derived";
            certainty: "none" | "unknown" | "confirmed";
            remote_pk: string | null;
            verification: "matches" | "missing_or_changed" | "unavailable" | null;
            recovery_action: "repair_attachment" | "verify_attachment" | null;
          }
        ]
      | [
          {
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            version_id: string;
            blob_sha256: string;
            byte_size: string;
            kind: "original" | "derived";
            certainty: "none" | "unknown" | "confirmed";
            remote_pk: string | null;
            verification: "matches" | "missing_or_changed" | "unavailable" | null;
            recovery_action: "repair_attachment" | "verify_attachment" | null;
          },
          {
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            version_id: string;
            blob_sha256: string;
            byte_size: string;
            kind: "original" | "derived";
            certainty: "none" | "unknown" | "confirmed";
            remote_pk: string | null;
            verification: "matches" | "missing_or_changed" | "unavailable" | null;
            recovery_action: "repair_attachment" | "verify_attachment" | null;
          },
          {
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            version_id: string;
            blob_sha256: string;
            byte_size: string;
            kind: "original" | "derived";
            certainty: "none" | "unknown" | "confirmed";
            remote_pk: string | null;
            verification: "matches" | "missing_or_changed" | "unavailable" | null;
            recovery_action: "repair_attachment" | "verify_attachment" | null;
          },
          {
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            version_id: string;
            blob_sha256: string;
            byte_size: string;
            kind: "original" | "derived";
            certainty: "none" | "unknown" | "confirmed";
            remote_pk: string | null;
            verification: "matches" | "missing_or_changed" | "unavailable" | null;
            recovery_action: "repair_attachment" | "verify_attachment" | null;
          },
          {
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            version_id: string;
            blob_sha256: string;
            byte_size: string;
            kind: "original" | "derived";
            certainty: "none" | "unknown" | "confirmed";
            remote_pk: string | null;
            verification: "matches" | "missing_or_changed" | "unavailable" | null;
            recovery_action: "repair_attachment" | "verify_attachment" | null;
          },
          {
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            version_id: string;
            blob_sha256: string;
            byte_size: string;
            kind: "original" | "derived";
            certainty: "none" | "unknown" | "confirmed";
            remote_pk: string | null;
            verification: "matches" | "missing_or_changed" | "unavailable" | null;
            recovery_action: "repair_attachment" | "verify_attachment" | null;
          }
        ]
      | [
          {
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            version_id: string;
            blob_sha256: string;
            byte_size: string;
            kind: "original" | "derived";
            certainty: "none" | "unknown" | "confirmed";
            remote_pk: string | null;
            verification: "matches" | "missing_or_changed" | "unavailable" | null;
            recovery_action: "repair_attachment" | "verify_attachment" | null;
          },
          {
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            version_id: string;
            blob_sha256: string;
            byte_size: string;
            kind: "original" | "derived";
            certainty: "none" | "unknown" | "confirmed";
            remote_pk: string | null;
            verification: "matches" | "missing_or_changed" | "unavailable" | null;
            recovery_action: "repair_attachment" | "verify_attachment" | null;
          },
          {
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            version_id: string;
            blob_sha256: string;
            byte_size: string;
            kind: "original" | "derived";
            certainty: "none" | "unknown" | "confirmed";
            remote_pk: string | null;
            verification: "matches" | "missing_or_changed" | "unavailable" | null;
            recovery_action: "repair_attachment" | "verify_attachment" | null;
          },
          {
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            version_id: string;
            blob_sha256: string;
            byte_size: string;
            kind: "original" | "derived";
            certainty: "none" | "unknown" | "confirmed";
            remote_pk: string | null;
            verification: "matches" | "missing_or_changed" | "unavailable" | null;
            recovery_action: "repair_attachment" | "verify_attachment" | null;
          },
          {
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            version_id: string;
            blob_sha256: string;
            byte_size: string;
            kind: "original" | "derived";
            certainty: "none" | "unknown" | "confirmed";
            remote_pk: string | null;
            verification: "matches" | "missing_or_changed" | "unavailable" | null;
            recovery_action: "repair_attachment" | "verify_attachment" | null;
          },
          {
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            version_id: string;
            blob_sha256: string;
            byte_size: string;
            kind: "original" | "derived";
            certainty: "none" | "unknown" | "confirmed";
            remote_pk: string | null;
            verification: "matches" | "missing_or_changed" | "unavailable" | null;
            recovery_action: "repair_attachment" | "verify_attachment" | null;
          },
          {
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            version_id: string;
            blob_sha256: string;
            byte_size: string;
            kind: "original" | "derived";
            certainty: "none" | "unknown" | "confirmed";
            remote_pk: string | null;
            verification: "matches" | "missing_or_changed" | "unavailable" | null;
            recovery_action: "repair_attachment" | "verify_attachment" | null;
          }
        ]
      | [
          {
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            version_id: string;
            blob_sha256: string;
            byte_size: string;
            kind: "original" | "derived";
            certainty: "none" | "unknown" | "confirmed";
            remote_pk: string | null;
            verification: "matches" | "missing_or_changed" | "unavailable" | null;
            recovery_action: "repair_attachment" | "verify_attachment" | null;
          },
          {
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            version_id: string;
            blob_sha256: string;
            byte_size: string;
            kind: "original" | "derived";
            certainty: "none" | "unknown" | "confirmed";
            remote_pk: string | null;
            verification: "matches" | "missing_or_changed" | "unavailable" | null;
            recovery_action: "repair_attachment" | "verify_attachment" | null;
          },
          {
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            version_id: string;
            blob_sha256: string;
            byte_size: string;
            kind: "original" | "derived";
            certainty: "none" | "unknown" | "confirmed";
            remote_pk: string | null;
            verification: "matches" | "missing_or_changed" | "unavailable" | null;
            recovery_action: "repair_attachment" | "verify_attachment" | null;
          },
          {
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            version_id: string;
            blob_sha256: string;
            byte_size: string;
            kind: "original" | "derived";
            certainty: "none" | "unknown" | "confirmed";
            remote_pk: string | null;
            verification: "matches" | "missing_or_changed" | "unavailable" | null;
            recovery_action: "repair_attachment" | "verify_attachment" | null;
          },
          {
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            version_id: string;
            blob_sha256: string;
            byte_size: string;
            kind: "original" | "derived";
            certainty: "none" | "unknown" | "confirmed";
            remote_pk: string | null;
            verification: "matches" | "missing_or_changed" | "unavailable" | null;
            recovery_action: "repair_attachment" | "verify_attachment" | null;
          },
          {
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            version_id: string;
            blob_sha256: string;
            byte_size: string;
            kind: "original" | "derived";
            certainty: "none" | "unknown" | "confirmed";
            remote_pk: string | null;
            verification: "matches" | "missing_or_changed" | "unavailable" | null;
            recovery_action: "repair_attachment" | "verify_attachment" | null;
          },
          {
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            version_id: string;
            blob_sha256: string;
            byte_size: string;
            kind: "original" | "derived";
            certainty: "none" | "unknown" | "confirmed";
            remote_pk: string | null;
            verification: "matches" | "missing_or_changed" | "unavailable" | null;
            recovery_action: "repair_attachment" | "verify_attachment" | null;
          },
          {
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            version_id: string;
            blob_sha256: string;
            byte_size: string;
            kind: "original" | "derived";
            certainty: "none" | "unknown" | "confirmed";
            remote_pk: string | null;
            verification: "matches" | "missing_or_changed" | "unavailable" | null;
            recovery_action: "repair_attachment" | "verify_attachment" | null;
          }
        ]
      | [
          {
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            version_id: string;
            blob_sha256: string;
            byte_size: string;
            kind: "original" | "derived";
            certainty: "none" | "unknown" | "confirmed";
            remote_pk: string | null;
            verification: "matches" | "missing_or_changed" | "unavailable" | null;
            recovery_action: "repair_attachment" | "verify_attachment" | null;
          },
          {
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            version_id: string;
            blob_sha256: string;
            byte_size: string;
            kind: "original" | "derived";
            certainty: "none" | "unknown" | "confirmed";
            remote_pk: string | null;
            verification: "matches" | "missing_or_changed" | "unavailable" | null;
            recovery_action: "repair_attachment" | "verify_attachment" | null;
          },
          {
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            version_id: string;
            blob_sha256: string;
            byte_size: string;
            kind: "original" | "derived";
            certainty: "none" | "unknown" | "confirmed";
            remote_pk: string | null;
            verification: "matches" | "missing_or_changed" | "unavailable" | null;
            recovery_action: "repair_attachment" | "verify_attachment" | null;
          },
          {
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            version_id: string;
            blob_sha256: string;
            byte_size: string;
            kind: "original" | "derived";
            certainty: "none" | "unknown" | "confirmed";
            remote_pk: string | null;
            verification: "matches" | "missing_or_changed" | "unavailable" | null;
            recovery_action: "repair_attachment" | "verify_attachment" | null;
          },
          {
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            version_id: string;
            blob_sha256: string;
            byte_size: string;
            kind: "original" | "derived";
            certainty: "none" | "unknown" | "confirmed";
            remote_pk: string | null;
            verification: "matches" | "missing_or_changed" | "unavailable" | null;
            recovery_action: "repair_attachment" | "verify_attachment" | null;
          },
          {
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            version_id: string;
            blob_sha256: string;
            byte_size: string;
            kind: "original" | "derived";
            certainty: "none" | "unknown" | "confirmed";
            remote_pk: string | null;
            verification: "matches" | "missing_or_changed" | "unavailable" | null;
            recovery_action: "repair_attachment" | "verify_attachment" | null;
          },
          {
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            version_id: string;
            blob_sha256: string;
            byte_size: string;
            kind: "original" | "derived";
            certainty: "none" | "unknown" | "confirmed";
            remote_pk: string | null;
            verification: "matches" | "missing_or_changed" | "unavailable" | null;
            recovery_action: "repair_attachment" | "verify_attachment" | null;
          },
          {
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            version_id: string;
            blob_sha256: string;
            byte_size: string;
            kind: "original" | "derived";
            certainty: "none" | "unknown" | "confirmed";
            remote_pk: string | null;
            verification: "matches" | "missing_or_changed" | "unavailable" | null;
            recovery_action: "repair_attachment" | "verify_attachment" | null;
          },
          {
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            version_id: string;
            blob_sha256: string;
            byte_size: string;
            kind: "original" | "derived";
            certainty: "none" | "unknown" | "confirmed";
            remote_pk: string | null;
            verification: "matches" | "missing_or_changed" | "unavailable" | null;
            recovery_action: "repair_attachment" | "verify_attachment" | null;
          }
        ]
      | [
          {
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            version_id: string;
            blob_sha256: string;
            byte_size: string;
            kind: "original" | "derived";
            certainty: "none" | "unknown" | "confirmed";
            remote_pk: string | null;
            verification: "matches" | "missing_or_changed" | "unavailable" | null;
            recovery_action: "repair_attachment" | "verify_attachment" | null;
          },
          {
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            version_id: string;
            blob_sha256: string;
            byte_size: string;
            kind: "original" | "derived";
            certainty: "none" | "unknown" | "confirmed";
            remote_pk: string | null;
            verification: "matches" | "missing_or_changed" | "unavailable" | null;
            recovery_action: "repair_attachment" | "verify_attachment" | null;
          },
          {
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            version_id: string;
            blob_sha256: string;
            byte_size: string;
            kind: "original" | "derived";
            certainty: "none" | "unknown" | "confirmed";
            remote_pk: string | null;
            verification: "matches" | "missing_or_changed" | "unavailable" | null;
            recovery_action: "repair_attachment" | "verify_attachment" | null;
          },
          {
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            version_id: string;
            blob_sha256: string;
            byte_size: string;
            kind: "original" | "derived";
            certainty: "none" | "unknown" | "confirmed";
            remote_pk: string | null;
            verification: "matches" | "missing_or_changed" | "unavailable" | null;
            recovery_action: "repair_attachment" | "verify_attachment" | null;
          },
          {
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            version_id: string;
            blob_sha256: string;
            byte_size: string;
            kind: "original" | "derived";
            certainty: "none" | "unknown" | "confirmed";
            remote_pk: string | null;
            verification: "matches" | "missing_or_changed" | "unavailable" | null;
            recovery_action: "repair_attachment" | "verify_attachment" | null;
          },
          {
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            version_id: string;
            blob_sha256: string;
            byte_size: string;
            kind: "original" | "derived";
            certainty: "none" | "unknown" | "confirmed";
            remote_pk: string | null;
            verification: "matches" | "missing_or_changed" | "unavailable" | null;
            recovery_action: "repair_attachment" | "verify_attachment" | null;
          },
          {
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            version_id: string;
            blob_sha256: string;
            byte_size: string;
            kind: "original" | "derived";
            certainty: "none" | "unknown" | "confirmed";
            remote_pk: string | null;
            verification: "matches" | "missing_or_changed" | "unavailable" | null;
            recovery_action: "repair_attachment" | "verify_attachment" | null;
          },
          {
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            version_id: string;
            blob_sha256: string;
            byte_size: string;
            kind: "original" | "derived";
            certainty: "none" | "unknown" | "confirmed";
            remote_pk: string | null;
            verification: "matches" | "missing_or_changed" | "unavailable" | null;
            recovery_action: "repair_attachment" | "verify_attachment" | null;
          },
          {
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            version_id: string;
            blob_sha256: string;
            byte_size: string;
            kind: "original" | "derived";
            certainty: "none" | "unknown" | "confirmed";
            remote_pk: string | null;
            verification: "matches" | "missing_or_changed" | "unavailable" | null;
            recovery_action: "repair_attachment" | "verify_attachment" | null;
          },
          {
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            version_id: string;
            blob_sha256: string;
            byte_size: string;
            kind: "original" | "derived";
            certainty: "none" | "unknown" | "confirmed";
            remote_pk: string | null;
            verification: "matches" | "missing_or_changed" | "unavailable" | null;
            recovery_action: "repair_attachment" | "verify_attachment" | null;
          }
        ];
    operations: {
      operation_key: string;
      lot_id: string;
      lot_label: string;
      quantity: string;
      certainty: "none" | "confirmed" | "unknown";
      remote_pk: string | null;
      recovery_allowed: boolean;
    }[];
    cursor: {
      stream_id: string;
      sequence: string;
    };
  }[];
  preparations: {
    id: string;
    batch_id: string;
    /**
     * @minItems 1
     * @maxItems 10
     */
    selected_lot_ids:
      | [string]
      | [string, string]
      | [string, string, string]
      | [string, string, string, string]
      | [string, string, string, string, string]
      | [string, string, string, string, string, string]
      | [string, string, string, string, string, string, string]
      | [string, string, string, string, string, string, string, string]
      | [string, string, string, string, string, string, string, string, string]
      | [string, string, string, string, string, string, string, string, string, string];
    remaining_lot_ids: string[];
    plan_sha256: string;
    review_fingerprint: string;
    target_revision: string;
    capability: "owned-fake-stock/1" | "owned-fake-media/1";
    /**
     * @maxItems 10
     */
    attachments?:
      | []
      | [
          {
            version_id: string;
            evidence_id: string;
            blob_sha256: string;
            byte_size: string;
            media_type: "image/jpeg" | "image/png" | "application/pdf";
            kind: "original" | "derived";
            original_version_id: string;
            original_sha256: string;
            recipe_sha256: string | null;
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            evidence_label: string;
            destination: "stock_attachment";
          }
        ]
      | [
          {
            version_id: string;
            evidence_id: string;
            blob_sha256: string;
            byte_size: string;
            media_type: "image/jpeg" | "image/png" | "application/pdf";
            kind: "original" | "derived";
            original_version_id: string;
            original_sha256: string;
            recipe_sha256: string | null;
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            evidence_label: string;
            destination: "stock_attachment";
          },
          {
            version_id: string;
            evidence_id: string;
            blob_sha256: string;
            byte_size: string;
            media_type: "image/jpeg" | "image/png" | "application/pdf";
            kind: "original" | "derived";
            original_version_id: string;
            original_sha256: string;
            recipe_sha256: string | null;
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            evidence_label: string;
            destination: "stock_attachment";
          }
        ]
      | [
          {
            version_id: string;
            evidence_id: string;
            blob_sha256: string;
            byte_size: string;
            media_type: "image/jpeg" | "image/png" | "application/pdf";
            kind: "original" | "derived";
            original_version_id: string;
            original_sha256: string;
            recipe_sha256: string | null;
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            evidence_label: string;
            destination: "stock_attachment";
          },
          {
            version_id: string;
            evidence_id: string;
            blob_sha256: string;
            byte_size: string;
            media_type: "image/jpeg" | "image/png" | "application/pdf";
            kind: "original" | "derived";
            original_version_id: string;
            original_sha256: string;
            recipe_sha256: string | null;
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            evidence_label: string;
            destination: "stock_attachment";
          },
          {
            version_id: string;
            evidence_id: string;
            blob_sha256: string;
            byte_size: string;
            media_type: "image/jpeg" | "image/png" | "application/pdf";
            kind: "original" | "derived";
            original_version_id: string;
            original_sha256: string;
            recipe_sha256: string | null;
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            evidence_label: string;
            destination: "stock_attachment";
          }
        ]
      | [
          {
            version_id: string;
            evidence_id: string;
            blob_sha256: string;
            byte_size: string;
            media_type: "image/jpeg" | "image/png" | "application/pdf";
            kind: "original" | "derived";
            original_version_id: string;
            original_sha256: string;
            recipe_sha256: string | null;
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            evidence_label: string;
            destination: "stock_attachment";
          },
          {
            version_id: string;
            evidence_id: string;
            blob_sha256: string;
            byte_size: string;
            media_type: "image/jpeg" | "image/png" | "application/pdf";
            kind: "original" | "derived";
            original_version_id: string;
            original_sha256: string;
            recipe_sha256: string | null;
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            evidence_label: string;
            destination: "stock_attachment";
          },
          {
            version_id: string;
            evidence_id: string;
            blob_sha256: string;
            byte_size: string;
            media_type: "image/jpeg" | "image/png" | "application/pdf";
            kind: "original" | "derived";
            original_version_id: string;
            original_sha256: string;
            recipe_sha256: string | null;
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            evidence_label: string;
            destination: "stock_attachment";
          },
          {
            version_id: string;
            evidence_id: string;
            blob_sha256: string;
            byte_size: string;
            media_type: "image/jpeg" | "image/png" | "application/pdf";
            kind: "original" | "derived";
            original_version_id: string;
            original_sha256: string;
            recipe_sha256: string | null;
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            evidence_label: string;
            destination: "stock_attachment";
          }
        ]
      | [
          {
            version_id: string;
            evidence_id: string;
            blob_sha256: string;
            byte_size: string;
            media_type: "image/jpeg" | "image/png" | "application/pdf";
            kind: "original" | "derived";
            original_version_id: string;
            original_sha256: string;
            recipe_sha256: string | null;
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            evidence_label: string;
            destination: "stock_attachment";
          },
          {
            version_id: string;
            evidence_id: string;
            blob_sha256: string;
            byte_size: string;
            media_type: "image/jpeg" | "image/png" | "application/pdf";
            kind: "original" | "derived";
            original_version_id: string;
            original_sha256: string;
            recipe_sha256: string | null;
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            evidence_label: string;
            destination: "stock_attachment";
          },
          {
            version_id: string;
            evidence_id: string;
            blob_sha256: string;
            byte_size: string;
            media_type: "image/jpeg" | "image/png" | "application/pdf";
            kind: "original" | "derived";
            original_version_id: string;
            original_sha256: string;
            recipe_sha256: string | null;
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            evidence_label: string;
            destination: "stock_attachment";
          },
          {
            version_id: string;
            evidence_id: string;
            blob_sha256: string;
            byte_size: string;
            media_type: "image/jpeg" | "image/png" | "application/pdf";
            kind: "original" | "derived";
            original_version_id: string;
            original_sha256: string;
            recipe_sha256: string | null;
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            evidence_label: string;
            destination: "stock_attachment";
          },
          {
            version_id: string;
            evidence_id: string;
            blob_sha256: string;
            byte_size: string;
            media_type: "image/jpeg" | "image/png" | "application/pdf";
            kind: "original" | "derived";
            original_version_id: string;
            original_sha256: string;
            recipe_sha256: string | null;
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            evidence_label: string;
            destination: "stock_attachment";
          }
        ]
      | [
          {
            version_id: string;
            evidence_id: string;
            blob_sha256: string;
            byte_size: string;
            media_type: "image/jpeg" | "image/png" | "application/pdf";
            kind: "original" | "derived";
            original_version_id: string;
            original_sha256: string;
            recipe_sha256: string | null;
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            evidence_label: string;
            destination: "stock_attachment";
          },
          {
            version_id: string;
            evidence_id: string;
            blob_sha256: string;
            byte_size: string;
            media_type: "image/jpeg" | "image/png" | "application/pdf";
            kind: "original" | "derived";
            original_version_id: string;
            original_sha256: string;
            recipe_sha256: string | null;
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            evidence_label: string;
            destination: "stock_attachment";
          },
          {
            version_id: string;
            evidence_id: string;
            blob_sha256: string;
            byte_size: string;
            media_type: "image/jpeg" | "image/png" | "application/pdf";
            kind: "original" | "derived";
            original_version_id: string;
            original_sha256: string;
            recipe_sha256: string | null;
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            evidence_label: string;
            destination: "stock_attachment";
          },
          {
            version_id: string;
            evidence_id: string;
            blob_sha256: string;
            byte_size: string;
            media_type: "image/jpeg" | "image/png" | "application/pdf";
            kind: "original" | "derived";
            original_version_id: string;
            original_sha256: string;
            recipe_sha256: string | null;
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            evidence_label: string;
            destination: "stock_attachment";
          },
          {
            version_id: string;
            evidence_id: string;
            blob_sha256: string;
            byte_size: string;
            media_type: "image/jpeg" | "image/png" | "application/pdf";
            kind: "original" | "derived";
            original_version_id: string;
            original_sha256: string;
            recipe_sha256: string | null;
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            evidence_label: string;
            destination: "stock_attachment";
          },
          {
            version_id: string;
            evidence_id: string;
            blob_sha256: string;
            byte_size: string;
            media_type: "image/jpeg" | "image/png" | "application/pdf";
            kind: "original" | "derived";
            original_version_id: string;
            original_sha256: string;
            recipe_sha256: string | null;
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            evidence_label: string;
            destination: "stock_attachment";
          }
        ]
      | [
          {
            version_id: string;
            evidence_id: string;
            blob_sha256: string;
            byte_size: string;
            media_type: "image/jpeg" | "image/png" | "application/pdf";
            kind: "original" | "derived";
            original_version_id: string;
            original_sha256: string;
            recipe_sha256: string | null;
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            evidence_label: string;
            destination: "stock_attachment";
          },
          {
            version_id: string;
            evidence_id: string;
            blob_sha256: string;
            byte_size: string;
            media_type: "image/jpeg" | "image/png" | "application/pdf";
            kind: "original" | "derived";
            original_version_id: string;
            original_sha256: string;
            recipe_sha256: string | null;
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            evidence_label: string;
            destination: "stock_attachment";
          },
          {
            version_id: string;
            evidence_id: string;
            blob_sha256: string;
            byte_size: string;
            media_type: "image/jpeg" | "image/png" | "application/pdf";
            kind: "original" | "derived";
            original_version_id: string;
            original_sha256: string;
            recipe_sha256: string | null;
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            evidence_label: string;
            destination: "stock_attachment";
          },
          {
            version_id: string;
            evidence_id: string;
            blob_sha256: string;
            byte_size: string;
            media_type: "image/jpeg" | "image/png" | "application/pdf";
            kind: "original" | "derived";
            original_version_id: string;
            original_sha256: string;
            recipe_sha256: string | null;
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            evidence_label: string;
            destination: "stock_attachment";
          },
          {
            version_id: string;
            evidence_id: string;
            blob_sha256: string;
            byte_size: string;
            media_type: "image/jpeg" | "image/png" | "application/pdf";
            kind: "original" | "derived";
            original_version_id: string;
            original_sha256: string;
            recipe_sha256: string | null;
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            evidence_label: string;
            destination: "stock_attachment";
          },
          {
            version_id: string;
            evidence_id: string;
            blob_sha256: string;
            byte_size: string;
            media_type: "image/jpeg" | "image/png" | "application/pdf";
            kind: "original" | "derived";
            original_version_id: string;
            original_sha256: string;
            recipe_sha256: string | null;
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            evidence_label: string;
            destination: "stock_attachment";
          },
          {
            version_id: string;
            evidence_id: string;
            blob_sha256: string;
            byte_size: string;
            media_type: "image/jpeg" | "image/png" | "application/pdf";
            kind: "original" | "derived";
            original_version_id: string;
            original_sha256: string;
            recipe_sha256: string | null;
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            evidence_label: string;
            destination: "stock_attachment";
          }
        ]
      | [
          {
            version_id: string;
            evidence_id: string;
            blob_sha256: string;
            byte_size: string;
            media_type: "image/jpeg" | "image/png" | "application/pdf";
            kind: "original" | "derived";
            original_version_id: string;
            original_sha256: string;
            recipe_sha256: string | null;
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            evidence_label: string;
            destination: "stock_attachment";
          },
          {
            version_id: string;
            evidence_id: string;
            blob_sha256: string;
            byte_size: string;
            media_type: "image/jpeg" | "image/png" | "application/pdf";
            kind: "original" | "derived";
            original_version_id: string;
            original_sha256: string;
            recipe_sha256: string | null;
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            evidence_label: string;
            destination: "stock_attachment";
          },
          {
            version_id: string;
            evidence_id: string;
            blob_sha256: string;
            byte_size: string;
            media_type: "image/jpeg" | "image/png" | "application/pdf";
            kind: "original" | "derived";
            original_version_id: string;
            original_sha256: string;
            recipe_sha256: string | null;
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            evidence_label: string;
            destination: "stock_attachment";
          },
          {
            version_id: string;
            evidence_id: string;
            blob_sha256: string;
            byte_size: string;
            media_type: "image/jpeg" | "image/png" | "application/pdf";
            kind: "original" | "derived";
            original_version_id: string;
            original_sha256: string;
            recipe_sha256: string | null;
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            evidence_label: string;
            destination: "stock_attachment";
          },
          {
            version_id: string;
            evidence_id: string;
            blob_sha256: string;
            byte_size: string;
            media_type: "image/jpeg" | "image/png" | "application/pdf";
            kind: "original" | "derived";
            original_version_id: string;
            original_sha256: string;
            recipe_sha256: string | null;
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            evidence_label: string;
            destination: "stock_attachment";
          },
          {
            version_id: string;
            evidence_id: string;
            blob_sha256: string;
            byte_size: string;
            media_type: "image/jpeg" | "image/png" | "application/pdf";
            kind: "original" | "derived";
            original_version_id: string;
            original_sha256: string;
            recipe_sha256: string | null;
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            evidence_label: string;
            destination: "stock_attachment";
          },
          {
            version_id: string;
            evidence_id: string;
            blob_sha256: string;
            byte_size: string;
            media_type: "image/jpeg" | "image/png" | "application/pdf";
            kind: "original" | "derived";
            original_version_id: string;
            original_sha256: string;
            recipe_sha256: string | null;
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            evidence_label: string;
            destination: "stock_attachment";
          },
          {
            version_id: string;
            evidence_id: string;
            blob_sha256: string;
            byte_size: string;
            media_type: "image/jpeg" | "image/png" | "application/pdf";
            kind: "original" | "derived";
            original_version_id: string;
            original_sha256: string;
            recipe_sha256: string | null;
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            evidence_label: string;
            destination: "stock_attachment";
          }
        ]
      | [
          {
            version_id: string;
            evidence_id: string;
            blob_sha256: string;
            byte_size: string;
            media_type: "image/jpeg" | "image/png" | "application/pdf";
            kind: "original" | "derived";
            original_version_id: string;
            original_sha256: string;
            recipe_sha256: string | null;
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            evidence_label: string;
            destination: "stock_attachment";
          },
          {
            version_id: string;
            evidence_id: string;
            blob_sha256: string;
            byte_size: string;
            media_type: "image/jpeg" | "image/png" | "application/pdf";
            kind: "original" | "derived";
            original_version_id: string;
            original_sha256: string;
            recipe_sha256: string | null;
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            evidence_label: string;
            destination: "stock_attachment";
          },
          {
            version_id: string;
            evidence_id: string;
            blob_sha256: string;
            byte_size: string;
            media_type: "image/jpeg" | "image/png" | "application/pdf";
            kind: "original" | "derived";
            original_version_id: string;
            original_sha256: string;
            recipe_sha256: string | null;
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            evidence_label: string;
            destination: "stock_attachment";
          },
          {
            version_id: string;
            evidence_id: string;
            blob_sha256: string;
            byte_size: string;
            media_type: "image/jpeg" | "image/png" | "application/pdf";
            kind: "original" | "derived";
            original_version_id: string;
            original_sha256: string;
            recipe_sha256: string | null;
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            evidence_label: string;
            destination: "stock_attachment";
          },
          {
            version_id: string;
            evidence_id: string;
            blob_sha256: string;
            byte_size: string;
            media_type: "image/jpeg" | "image/png" | "application/pdf";
            kind: "original" | "derived";
            original_version_id: string;
            original_sha256: string;
            recipe_sha256: string | null;
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            evidence_label: string;
            destination: "stock_attachment";
          },
          {
            version_id: string;
            evidence_id: string;
            blob_sha256: string;
            byte_size: string;
            media_type: "image/jpeg" | "image/png" | "application/pdf";
            kind: "original" | "derived";
            original_version_id: string;
            original_sha256: string;
            recipe_sha256: string | null;
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            evidence_label: string;
            destination: "stock_attachment";
          },
          {
            version_id: string;
            evidence_id: string;
            blob_sha256: string;
            byte_size: string;
            media_type: "image/jpeg" | "image/png" | "application/pdf";
            kind: "original" | "derived";
            original_version_id: string;
            original_sha256: string;
            recipe_sha256: string | null;
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            evidence_label: string;
            destination: "stock_attachment";
          },
          {
            version_id: string;
            evidence_id: string;
            blob_sha256: string;
            byte_size: string;
            media_type: "image/jpeg" | "image/png" | "application/pdf";
            kind: "original" | "derived";
            original_version_id: string;
            original_sha256: string;
            recipe_sha256: string | null;
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            evidence_label: string;
            destination: "stock_attachment";
          },
          {
            version_id: string;
            evidence_id: string;
            blob_sha256: string;
            byte_size: string;
            media_type: "image/jpeg" | "image/png" | "application/pdf";
            kind: "original" | "derived";
            original_version_id: string;
            original_sha256: string;
            recipe_sha256: string | null;
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            evidence_label: string;
            destination: "stock_attachment";
          }
        ]
      | [
          {
            version_id: string;
            evidence_id: string;
            blob_sha256: string;
            byte_size: string;
            media_type: "image/jpeg" | "image/png" | "application/pdf";
            kind: "original" | "derived";
            original_version_id: string;
            original_sha256: string;
            recipe_sha256: string | null;
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            evidence_label: string;
            destination: "stock_attachment";
          },
          {
            version_id: string;
            evidence_id: string;
            blob_sha256: string;
            byte_size: string;
            media_type: "image/jpeg" | "image/png" | "application/pdf";
            kind: "original" | "derived";
            original_version_id: string;
            original_sha256: string;
            recipe_sha256: string | null;
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            evidence_label: string;
            destination: "stock_attachment";
          },
          {
            version_id: string;
            evidence_id: string;
            blob_sha256: string;
            byte_size: string;
            media_type: "image/jpeg" | "image/png" | "application/pdf";
            kind: "original" | "derived";
            original_version_id: string;
            original_sha256: string;
            recipe_sha256: string | null;
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            evidence_label: string;
            destination: "stock_attachment";
          },
          {
            version_id: string;
            evidence_id: string;
            blob_sha256: string;
            byte_size: string;
            media_type: "image/jpeg" | "image/png" | "application/pdf";
            kind: "original" | "derived";
            original_version_id: string;
            original_sha256: string;
            recipe_sha256: string | null;
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            evidence_label: string;
            destination: "stock_attachment";
          },
          {
            version_id: string;
            evidence_id: string;
            blob_sha256: string;
            byte_size: string;
            media_type: "image/jpeg" | "image/png" | "application/pdf";
            kind: "original" | "derived";
            original_version_id: string;
            original_sha256: string;
            recipe_sha256: string | null;
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            evidence_label: string;
            destination: "stock_attachment";
          },
          {
            version_id: string;
            evidence_id: string;
            blob_sha256: string;
            byte_size: string;
            media_type: "image/jpeg" | "image/png" | "application/pdf";
            kind: "original" | "derived";
            original_version_id: string;
            original_sha256: string;
            recipe_sha256: string | null;
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            evidence_label: string;
            destination: "stock_attachment";
          },
          {
            version_id: string;
            evidence_id: string;
            blob_sha256: string;
            byte_size: string;
            media_type: "image/jpeg" | "image/png" | "application/pdf";
            kind: "original" | "derived";
            original_version_id: string;
            original_sha256: string;
            recipe_sha256: string | null;
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            evidence_label: string;
            destination: "stock_attachment";
          },
          {
            version_id: string;
            evidence_id: string;
            blob_sha256: string;
            byte_size: string;
            media_type: "image/jpeg" | "image/png" | "application/pdf";
            kind: "original" | "derived";
            original_version_id: string;
            original_sha256: string;
            recipe_sha256: string | null;
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            evidence_label: string;
            destination: "stock_attachment";
          },
          {
            version_id: string;
            evidence_id: string;
            blob_sha256: string;
            byte_size: string;
            media_type: "image/jpeg" | "image/png" | "application/pdf";
            kind: "original" | "derived";
            original_version_id: string;
            original_sha256: string;
            recipe_sha256: string | null;
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            evidence_label: string;
            destination: "stock_attachment";
          },
          {
            version_id: string;
            evidence_id: string;
            blob_sha256: string;
            byte_size: string;
            media_type: "image/jpeg" | "image/png" | "application/pdf";
            kind: "original" | "derived";
            original_version_id: string;
            original_sha256: string;
            recipe_sha256: string | null;
            artifact_key: string;
            lot_id: string;
            lot_label: string;
            evidence_label: string;
            destination: "stock_attachment";
          }
        ];
    /**
     * @maxItems 64
     */
    evidence?: {
      version_id: string;
      evidence_id: string;
      blob_sha256: string;
      byte_size: string;
      media_type: "image/jpeg" | "image/png" | "application/pdf";
      kind: "original" | "derived";
      original_version_id: string;
      original_sha256: string;
      recipe_sha256: string | null;
    }[];
    media_inputs_sha256?: string;
    /**
     * @minItems 1
     * @maxItems 10
     */
    effects:
      | [
          {
            lot_id: string;
            lot_label: string;
            part_id: string;
            part_label: string;
            quantity: string;
            location_id: string | null;
            location_label: string;
            contribution_key: string;
            barcode: string;
          }
        ]
      | [
          {
            lot_id: string;
            lot_label: string;
            part_id: string;
            part_label: string;
            quantity: string;
            location_id: string | null;
            location_label: string;
            contribution_key: string;
            barcode: string;
          },
          {
            lot_id: string;
            lot_label: string;
            part_id: string;
            part_label: string;
            quantity: string;
            location_id: string | null;
            location_label: string;
            contribution_key: string;
            barcode: string;
          }
        ]
      | [
          {
            lot_id: string;
            lot_label: string;
            part_id: string;
            part_label: string;
            quantity: string;
            location_id: string | null;
            location_label: string;
            contribution_key: string;
            barcode: string;
          },
          {
            lot_id: string;
            lot_label: string;
            part_id: string;
            part_label: string;
            quantity: string;
            location_id: string | null;
            location_label: string;
            contribution_key: string;
            barcode: string;
          },
          {
            lot_id: string;
            lot_label: string;
            part_id: string;
            part_label: string;
            quantity: string;
            location_id: string | null;
            location_label: string;
            contribution_key: string;
            barcode: string;
          }
        ]
      | [
          {
            lot_id: string;
            lot_label: string;
            part_id: string;
            part_label: string;
            quantity: string;
            location_id: string | null;
            location_label: string;
            contribution_key: string;
            barcode: string;
          },
          {
            lot_id: string;
            lot_label: string;
            part_id: string;
            part_label: string;
            quantity: string;
            location_id: string | null;
            location_label: string;
            contribution_key: string;
            barcode: string;
          },
          {
            lot_id: string;
            lot_label: string;
            part_id: string;
            part_label: string;
            quantity: string;
            location_id: string | null;
            location_label: string;
            contribution_key: string;
            barcode: string;
          },
          {
            lot_id: string;
            lot_label: string;
            part_id: string;
            part_label: string;
            quantity: string;
            location_id: string | null;
            location_label: string;
            contribution_key: string;
            barcode: string;
          }
        ]
      | [
          {
            lot_id: string;
            lot_label: string;
            part_id: string;
            part_label: string;
            quantity: string;
            location_id: string | null;
            location_label: string;
            contribution_key: string;
            barcode: string;
          },
          {
            lot_id: string;
            lot_label: string;
            part_id: string;
            part_label: string;
            quantity: string;
            location_id: string | null;
            location_label: string;
            contribution_key: string;
            barcode: string;
          },
          {
            lot_id: string;
            lot_label: string;
            part_id: string;
            part_label: string;
            quantity: string;
            location_id: string | null;
            location_label: string;
            contribution_key: string;
            barcode: string;
          },
          {
            lot_id: string;
            lot_label: string;
            part_id: string;
            part_label: string;
            quantity: string;
            location_id: string | null;
            location_label: string;
            contribution_key: string;
            barcode: string;
          },
          {
            lot_id: string;
            lot_label: string;
            part_id: string;
            part_label: string;
            quantity: string;
            location_id: string | null;
            location_label: string;
            contribution_key: string;
            barcode: string;
          }
        ]
      | [
          {
            lot_id: string;
            lot_label: string;
            part_id: string;
            part_label: string;
            quantity: string;
            location_id: string | null;
            location_label: string;
            contribution_key: string;
            barcode: string;
          },
          {
            lot_id: string;
            lot_label: string;
            part_id: string;
            part_label: string;
            quantity: string;
            location_id: string | null;
            location_label: string;
            contribution_key: string;
            barcode: string;
          },
          {
            lot_id: string;
            lot_label: string;
            part_id: string;
            part_label: string;
            quantity: string;
            location_id: string | null;
            location_label: string;
            contribution_key: string;
            barcode: string;
          },
          {
            lot_id: string;
            lot_label: string;
            part_id: string;
            part_label: string;
            quantity: string;
            location_id: string | null;
            location_label: string;
            contribution_key: string;
            barcode: string;
          },
          {
            lot_id: string;
            lot_label: string;
            part_id: string;
            part_label: string;
            quantity: string;
            location_id: string | null;
            location_label: string;
            contribution_key: string;
            barcode: string;
          },
          {
            lot_id: string;
            lot_label: string;
            part_id: string;
            part_label: string;
            quantity: string;
            location_id: string | null;
            location_label: string;
            contribution_key: string;
            barcode: string;
          }
        ]
      | [
          {
            lot_id: string;
            lot_label: string;
            part_id: string;
            part_label: string;
            quantity: string;
            location_id: string | null;
            location_label: string;
            contribution_key: string;
            barcode: string;
          },
          {
            lot_id: string;
            lot_label: string;
            part_id: string;
            part_label: string;
            quantity: string;
            location_id: string | null;
            location_label: string;
            contribution_key: string;
            barcode: string;
          },
          {
            lot_id: string;
            lot_label: string;
            part_id: string;
            part_label: string;
            quantity: string;
            location_id: string | null;
            location_label: string;
            contribution_key: string;
            barcode: string;
          },
          {
            lot_id: string;
            lot_label: string;
            part_id: string;
            part_label: string;
            quantity: string;
            location_id: string | null;
            location_label: string;
            contribution_key: string;
            barcode: string;
          },
          {
            lot_id: string;
            lot_label: string;
            part_id: string;
            part_label: string;
            quantity: string;
            location_id: string | null;
            location_label: string;
            contribution_key: string;
            barcode: string;
          },
          {
            lot_id: string;
            lot_label: string;
            part_id: string;
            part_label: string;
            quantity: string;
            location_id: string | null;
            location_label: string;
            contribution_key: string;
            barcode: string;
          },
          {
            lot_id: string;
            lot_label: string;
            part_id: string;
            part_label: string;
            quantity: string;
            location_id: string | null;
            location_label: string;
            contribution_key: string;
            barcode: string;
          }
        ]
      | [
          {
            lot_id: string;
            lot_label: string;
            part_id: string;
            part_label: string;
            quantity: string;
            location_id: string | null;
            location_label: string;
            contribution_key: string;
            barcode: string;
          },
          {
            lot_id: string;
            lot_label: string;
            part_id: string;
            part_label: string;
            quantity: string;
            location_id: string | null;
            location_label: string;
            contribution_key: string;
            barcode: string;
          },
          {
            lot_id: string;
            lot_label: string;
            part_id: string;
            part_label: string;
            quantity: string;
            location_id: string | null;
            location_label: string;
            contribution_key: string;
            barcode: string;
          },
          {
            lot_id: string;
            lot_label: string;
            part_id: string;
            part_label: string;
            quantity: string;
            location_id: string | null;
            location_label: string;
            contribution_key: string;
            barcode: string;
          },
          {
            lot_id: string;
            lot_label: string;
            part_id: string;
            part_label: string;
            quantity: string;
            location_id: string | null;
            location_label: string;
            contribution_key: string;
            barcode: string;
          },
          {
            lot_id: string;
            lot_label: string;
            part_id: string;
            part_label: string;
            quantity: string;
            location_id: string | null;
            location_label: string;
            contribution_key: string;
            barcode: string;
          },
          {
            lot_id: string;
            lot_label: string;
            part_id: string;
            part_label: string;
            quantity: string;
            location_id: string | null;
            location_label: string;
            contribution_key: string;
            barcode: string;
          },
          {
            lot_id: string;
            lot_label: string;
            part_id: string;
            part_label: string;
            quantity: string;
            location_id: string | null;
            location_label: string;
            contribution_key: string;
            barcode: string;
          }
        ]
      | [
          {
            lot_id: string;
            lot_label: string;
            part_id: string;
            part_label: string;
            quantity: string;
            location_id: string | null;
            location_label: string;
            contribution_key: string;
            barcode: string;
          },
          {
            lot_id: string;
            lot_label: string;
            part_id: string;
            part_label: string;
            quantity: string;
            location_id: string | null;
            location_label: string;
            contribution_key: string;
            barcode: string;
          },
          {
            lot_id: string;
            lot_label: string;
            part_id: string;
            part_label: string;
            quantity: string;
            location_id: string | null;
            location_label: string;
            contribution_key: string;
            barcode: string;
          },
          {
            lot_id: string;
            lot_label: string;
            part_id: string;
            part_label: string;
            quantity: string;
            location_id: string | null;
            location_label: string;
            contribution_key: string;
            barcode: string;
          },
          {
            lot_id: string;
            lot_label: string;
            part_id: string;
            part_label: string;
            quantity: string;
            location_id: string | null;
            location_label: string;
            contribution_key: string;
            barcode: string;
          },
          {
            lot_id: string;
            lot_label: string;
            part_id: string;
            part_label: string;
            quantity: string;
            location_id: string | null;
            location_label: string;
            contribution_key: string;
            barcode: string;
          },
          {
            lot_id: string;
            lot_label: string;
            part_id: string;
            part_label: string;
            quantity: string;
            location_id: string | null;
            location_label: string;
            contribution_key: string;
            barcode: string;
          },
          {
            lot_id: string;
            lot_label: string;
            part_id: string;
            part_label: string;
            quantity: string;
            location_id: string | null;
            location_label: string;
            contribution_key: string;
            barcode: string;
          },
          {
            lot_id: string;
            lot_label: string;
            part_id: string;
            part_label: string;
            quantity: string;
            location_id: string | null;
            location_label: string;
            contribution_key: string;
            barcode: string;
          }
        ]
      | [
          {
            lot_id: string;
            lot_label: string;
            part_id: string;
            part_label: string;
            quantity: string;
            location_id: string | null;
            location_label: string;
            contribution_key: string;
            barcode: string;
          },
          {
            lot_id: string;
            lot_label: string;
            part_id: string;
            part_label: string;
            quantity: string;
            location_id: string | null;
            location_label: string;
            contribution_key: string;
            barcode: string;
          },
          {
            lot_id: string;
            lot_label: string;
            part_id: string;
            part_label: string;
            quantity: string;
            location_id: string | null;
            location_label: string;
            contribution_key: string;
            barcode: string;
          },
          {
            lot_id: string;
            lot_label: string;
            part_id: string;
            part_label: string;
            quantity: string;
            location_id: string | null;
            location_label: string;
            contribution_key: string;
            barcode: string;
          },
          {
            lot_id: string;
            lot_label: string;
            part_id: string;
            part_label: string;
            quantity: string;
            location_id: string | null;
            location_label: string;
            contribution_key: string;
            barcode: string;
          },
          {
            lot_id: string;
            lot_label: string;
            part_id: string;
            part_label: string;
            quantity: string;
            location_id: string | null;
            location_label: string;
            contribution_key: string;
            barcode: string;
          },
          {
            lot_id: string;
            lot_label: string;
            part_id: string;
            part_label: string;
            quantity: string;
            location_id: string | null;
            location_label: string;
            contribution_key: string;
            barcode: string;
          },
          {
            lot_id: string;
            lot_label: string;
            part_id: string;
            part_label: string;
            quantity: string;
            location_id: string | null;
            location_label: string;
            contribution_key: string;
            barcode: string;
          },
          {
            lot_id: string;
            lot_label: string;
            part_id: string;
            part_label: string;
            quantity: string;
            location_id: string | null;
            location_label: string;
            contribution_key: string;
            barcode: string;
          },
          {
            lot_id: string;
            lot_label: string;
            part_id: string;
            part_label: string;
            quantity: string;
            location_id: string | null;
            location_label: string;
            contribution_key: string;
            barcode: string;
          }
        ];
  }[];
  preparations_truncated: boolean;
  cursor: {
    stream_id: string;
    sequence: string;
  };
}

export interface ManualActivity {
  runs: {
    batch_id: string;
    run_id: string;
    state: "queued" | "running" | "stopping" | "settled_complete" | "settled_incomplete" | "recovery_required";
  }[];
  truncated: boolean;
}

export interface MediaRecipe {
  version: "documentary-crop/1";
  source_version_id: string;
  source_digest: string;
  page: number;
  source_width: number;
  source_height: number;
  x: number;
  y: number;
  width: number;
  height: number;
  quarter_turns: number;
}

export interface MediaVersion {
  id: string;
  evidence_id: string;
  kind: "original" | "derived";
  digest: string;
  byte_size: string;
  media_type: "image/jpeg" | "image/png" | "application/pdf" | "application/octet-stream";
  state: "queued" | "ready" | "unsupported" | "encrypted" | "malformed" | "limit_exceeded" | "interrupted";
  decoder_build: string | null;
  recipe: {
    version: "documentary-crop/1";
    source_version_id: string;
    source_digest: string;
    page: number;
    source_width: number;
    source_height: number;
    x: number;
    y: number;
    width: number;
    height: number;
    quarter_turns: number;
  } | null;
  /**
   * @maxItems 30
   */
  pages: {
    page: number;
    width: number;
    height: number;
    preview_id: string;
  }[];
}

export interface MediaSnapshot {
  batch_id: string;
  revision: string;
  /**
   * @maxItems 200
   */
  evidence: {
    id: string;
    label: string;
    group_id: string | null;
    /**
     * @maxItems 200
     */
    linked_subject_ids: string[];
    /**
     * @maxItems 100
     */
    versions: {
      id: string;
      evidence_id: string;
      kind: "original" | "derived";
      digest: string;
      byte_size: string;
      media_type: "image/jpeg" | "image/png" | "application/pdf" | "application/octet-stream";
      state: "queued" | "ready" | "unsupported" | "encrypted" | "malformed" | "limit_exceeded" | "interrupted";
      decoder_build: string | null;
      recipe: {
        version: "documentary-crop/1";
        source_version_id: string;
        source_digest: string;
        page: number;
        source_width: number;
        source_height: number;
        x: number;
        y: number;
        width: number;
        height: number;
        quarter_turns: number;
      } | null;
      /**
       * @maxItems 30
       */
      pages: {
        page: number;
        width: number;
        height: number;
        preview_id: string;
      }[];
    }[];
  }[];
  /**
   * @maxItems 200
   */
  attachments: {
    id: string;
    subject_id: string;
    mode: "selected" | "declined" | "unset";
    version_id: string | null;
    destination: "lot_attachment";
  }[];
  /**
   * @maxItems 100
   */
  groups: {
    id: string;
    label: string;
  }[];
  /**
   * @maxItems 200
   */
  derivations: {
    id: string;
    evidence_id: string;
    recipe: {
      version: "documentary-crop/1";
      source_version_id: string;
      source_digest: string;
      page: number;
      source_width: number;
      source_height: number;
      x: number;
      y: number;
      width: number;
      height: number;
      quarter_turns: number;
    };
    state: "queued" | "ready" | "unsupported" | "encrypted" | "malformed" | "limit_exceeded" | "interrupted";
    version_id: string | null;
  }[];
}

export interface MediaReceipt {
  status: "retained";
  batch_id: string;
  evidence_id: string;
  version: {
    id: string;
    evidence_id: string;
    kind: "original" | "derived";
    digest: string;
    byte_size: string;
    media_type: "image/jpeg" | "image/png" | "application/pdf" | "application/octet-stream";
    state: "queued" | "ready" | "unsupported" | "encrypted" | "malformed" | "limit_exceeded" | "interrupted";
    decoder_build: string | null;
    recipe: {
      version: "documentary-crop/1";
      source_version_id: string;
      source_digest: string;
      page: number;
      source_width: number;
      source_height: number;
      x: number;
      y: number;
      width: number;
      height: number;
      quarter_turns: number;
    } | null;
    /**
     * @maxItems 30
     */
    pages: {
      page: number;
      width: number;
      height: number;
      preview_id: string;
    }[];
  };
}

export interface MediaEdit {
  expected_revision: string;
  change:
    | {
        kind: "group";
        label: string;
      }
    | {
        kind: "move";
        evidence_id: string;
        group_id: string | null;
      }
    | {
        kind: "link";
        evidence_id: string;
        subject_id: string;
        linked: boolean;
      }
    | {
        kind: "derive";
        evidence_id: string;
        recipe: {
          version: "documentary-crop/1";
          source_version_id: string;
          source_digest: string;
          page: number;
          source_width: number;
          source_height: number;
          x: number;
          y: number;
          width: number;
          height: number;
          quarter_turns: number;
        };
      }
    | {
        kind: "select_attachment";
        subject_id: string;
        mode: "selected" | "declined" | "unset";
        version_id: string | null;
        destination: "lot_attachment";
      };
}
