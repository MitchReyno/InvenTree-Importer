export interface paths {
    "/api/v1/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Health */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Health"];
                    };
                };
                /** @description ErrorDto */
                default: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorDto"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/bootstrap": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Bootstrap */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Bootstrap"];
                    };
                };
                /** @description ErrorDto */
                default: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorDto"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/batches": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description CaptureList */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CaptureList"];
                    };
                };
                /** @description ErrorDto */
                default: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorDto"];
                    };
                };
            };
        };
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["BatchCreate"];
                };
            };
            responses: {
                /** @description CaptureSnapshot */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CaptureSnapshot"];
                    };
                };
                /** @description ErrorDto */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorDto"];
                    };
                };
                /** @description ErrorDto */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorDto"];
                    };
                };
                /** @description ErrorDto */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorDto"];
                    };
                };
                /** @description ErrorDto */
                412: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorDto"];
                    };
                };
                /** @description ErrorDto */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorDto"];
                    };
                };
                /** @description ErrorDto */
                default: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorDto"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/batches/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description CaptureSnapshot */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CaptureSnapshot"];
                    };
                };
                /** @description ErrorDto */
                default: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorDto"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/batches/{id}/edits": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["CaptureEdit"];
                };
            };
            responses: {
                /** @description CaptureSnapshot */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CaptureSnapshot"];
                    };
                };
                /** @description ErrorDto */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorDto"];
                    };
                };
                /** @description ErrorDto */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorDto"];
                    };
                };
                /** @description ErrorDto */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorDto"];
                    };
                };
                /** @description ErrorDto */
                412: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorDto"];
                    };
                };
                /** @description ErrorDto */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorDto"];
                    };
                };
                /** @description ErrorDto */
                default: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorDto"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/batches/{id}/observations": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["CaptureObserve"];
                };
            };
            responses: {
                /** @description CaptureObservation */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CaptureObservation"];
                    };
                };
                /** @description ErrorDto */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorDto"];
                    };
                };
                /** @description ErrorDto */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorDto"];
                    };
                };
                /** @description ErrorDto */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorDto"];
                    };
                };
                /** @description ErrorDto */
                412: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorDto"];
                    };
                };
                /** @description ErrorDto */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorDto"];
                    };
                };
                /** @description ErrorDto */
                default: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorDto"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/activity": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description ManualActivity */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ManualActivity"];
                    };
                };
                /** @description ErrorDto */
                default: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorDto"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/batches/{id}/manual": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description ManualWorkspace */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ManualWorkspace"];
                    };
                };
                /** @description ErrorDto */
                default: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorDto"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/batches/{id}/reviews": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["ManualScope"];
                };
            };
            responses: {
                /** @description ManualReviewResult */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ManualReviewResult"];
                    };
                };
                /** @description ErrorDto */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorDto"];
                    };
                };
                /** @description ErrorDto */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorDto"];
                    };
                };
                /** @description ErrorDto */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorDto"];
                    };
                };
                /** @description ErrorDto */
                412: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorDto"];
                    };
                };
                /** @description ErrorDto */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorDto"];
                    };
                };
                /** @description ErrorDto */
                default: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorDto"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/batches/{id}/preparations": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["ManualScope"];
                };
            };
            responses: {
                /** @description ManualPreparationResult */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ManualPreparationResult"];
                    };
                };
                /** @description ErrorDto */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorDto"];
                    };
                };
                /** @description ErrorDto */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorDto"];
                    };
                };
                /** @description ErrorDto */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorDto"];
                    };
                };
                /** @description ErrorDto */
                412: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorDto"];
                    };
                };
                /** @description ErrorDto */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorDto"];
                    };
                };
                /** @description ErrorDto */
                default: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorDto"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/preparations/{id}/approvals": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["Approval"];
                };
            };
            responses: {
                /** @description ManualAccepted */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ManualAccepted"];
                    };
                };
                /** @description ErrorDto */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorDto"];
                    };
                };
                /** @description ErrorDto */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorDto"];
                    };
                };
                /** @description ErrorDto */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorDto"];
                    };
                };
                /** @description ErrorDto */
                412: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorDto"];
                    };
                };
                /** @description ErrorDto */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorDto"];
                    };
                };
                /** @description ErrorDto */
                default: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorDto"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/runs/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description ManualRun */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ManualRun"];
                    };
                };
                /** @description ErrorDto */
                default: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorDto"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/runs/{id}/start": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["ManualRunCommand"];
                };
            };
            responses: {
                /** @description ManualAccepted */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ManualAccepted"];
                    };
                };
                /** @description ErrorDto */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorDto"];
                    };
                };
                /** @description ErrorDto */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorDto"];
                    };
                };
                /** @description ErrorDto */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorDto"];
                    };
                };
                /** @description ErrorDto */
                412: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorDto"];
                    };
                };
                /** @description ErrorDto */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorDto"];
                    };
                };
                /** @description ErrorDto */
                default: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorDto"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/runs/{id}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["ManualRunCommand"];
                };
            };
            responses: {
                /** @description ManualAccepted */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ManualAccepted"];
                    };
                };
                /** @description ErrorDto */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorDto"];
                    };
                };
                /** @description ErrorDto */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorDto"];
                    };
                };
                /** @description ErrorDto */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorDto"];
                    };
                };
                /** @description ErrorDto */
                412: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorDto"];
                    };
                };
                /** @description ErrorDto */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorDto"];
                    };
                };
                /** @description ErrorDto */
                default: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorDto"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/runs/{id}/recover": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["ManualRecoveryCommand"];
                };
            };
            responses: {
                /** @description ManualAccepted */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ManualAccepted"];
                    };
                };
                /** @description ErrorDto */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorDto"];
                    };
                };
                /** @description ErrorDto */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorDto"];
                    };
                };
                /** @description ErrorDto */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorDto"];
                    };
                };
                /** @description ErrorDto */
                412: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorDto"];
                    };
                };
                /** @description ErrorDto */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorDto"];
                    };
                };
                /** @description ErrorDto */
                default: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorDto"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        BatchCreate: {
            title: string;
            note: string;
        };
        LotCreate: {
            /** Format: int64 */
            expected_batch_revision: string;
            label: string;
            note: string;
            part_subject_id: string | null;
        };
        PartSelection: {
            /** Format: int64 */
            expected_revision: string;
            choice: {
                target_context_id: string;
                /** @constant */
                model: "part";
                /** Format: int64 */
                pk: string;
                observation_id: string;
            };
        };
        LotSelection: {
            /** Format: int64 */
            expected_revision: string;
            quantity?: {
                /** @constant */
                mode: "inherit";
            } | {
                /** @constant */
                mode: "clear";
            } | {
                /** @constant */
                mode: "set";
                value: string;
            };
            location?: {
                /** @constant */
                mode: "inherit";
            } | {
                /** @constant */
                mode: "clear";
            } | {
                /** @constant */
                mode: "set";
                value: {
                    target_context_id: string;
                    /** @constant */
                    model: "location";
                    /** Format: int64 */
                    pk: string;
                    observation_id: string;
                };
            };
        };
        Preparation: {
            /** Format: int64 */
            expected_batch_revision: string;
            selected_lot_ids: string[];
        };
        Approval: {
            preparation_id: string;
            expected_plan_sha256: string;
            expected_review_fingerprint: string;
            selected_lot_ids: string[];
            /** Format: int64 */
            expected_target_revision: string;
        };
        Cancellation: {
            /** Format: int64 */
            expected_run_revision: string;
        };
        RunSnapshot: {
            run_id: string;
            /** Format: int64 */
            revision: string;
            state: "queued" | "running" | "stopping" | "settled_complete" | "settled_incomplete" | "recovery_required";
            effect_certainty: "none" | "confirmed" | "unknown" | "mixed";
            confirmed_stock_ids: string[];
            cursor: {
                stream_id: string;
                /** Format: int64 */
                sequence: string;
            };
        };
        WorkerEnvelope: {
            /** @constant */
            schema_version: "bench-intake-worker/1";
            command_id: string;
            attempt_id: string;
            input_sha256: string;
            handler_version: string;
            /** Format: int64 */
            sequence: string;
            /** @constant */
            kind: "progress";
            payload: {
                /** @constant */
                state: "running";
            };
        } | {
            /** @constant */
            schema_version: "bench-intake-worker/1";
            command_id: string;
            attempt_id: string;
            input_sha256: string;
            handler_version: string;
            /** Format: int64 */
            sequence: string;
            /** @constant */
            kind: "terminal";
            payload: {
                state: "interrupted" | "completed";
            };
        };
        ErrorDto: {
            code: string;
            message: string;
            recovery: "refresh" | "wait" | "review" | "none";
            correlation_id: string;
        };
        Bootstrap: {
            /** @constant */
            mode: "development-key";
            /** @constant */
            banner: "Single-operator development mode — not a verified human session";
            status: "configured" | "setup_required";
            actor_id: string;
            target_id: string;
            target_context_id: string;
            /** @constant */
            mutation_enabled: false;
            /** @constant */
            permission_gate: "deferred_T11";
            csrf_token: string | null;
        };
        Health: {
            /** @constant */
            status: "ok";
            /** @constant */
            api_version: "bench-intake-app/1";
        };
        CaptureRef: {
            observation_id: string;
            target_context_id: string;
            model: "part" | "location";
            /** Format: int64 */
            pk: string;
        };
        CaptureQuantity: {
            /** @constant */
            mode: "unset";
        } | {
            /** @constant */
            mode: "unknown";
        } | {
            /** @constant */
            mode: "clear";
        } | {
            /** @constant */
            mode: "set";
            value: string;
        } | {
            /** @constant */
            mode: "inherit";
        };
        CaptureLocation: {
            /** @constant */
            mode: "unset";
        } | {
            /** @constant */
            mode: "unknown";
        } | {
            /** @constant */
            mode: "clear";
        } | {
            /** @constant */
            mode: "set";
            value: {
                observation_id: string;
                target_context_id: string;
                model: "part" | "location";
                /** Format: int64 */
                pk: string;
            };
        } | {
            /** @constant */
            mode: "inherit";
        };
        CapturePartChoice: {
            /** @constant */
            mode: "unset";
        } | {
            /** @constant */
            mode: "unknown";
        } | {
            /** @constant */
            mode: "clear";
        } | {
            /** @constant */
            mode: "set";
            value: {
                observation_id: string;
                target_context_id: string;
                model: "part" | "location";
                /** Format: int64 */
                pk: string;
            };
        };
        CaptureDefaults: {
            quantity: {
                /** @constant */
                mode: "unset";
            } | {
                /** @constant */
                mode: "unknown";
            } | {
                /** @constant */
                mode: "clear";
            } | {
                /** @constant */
                mode: "set";
                value: string;
            } | {
                /** @constant */
                mode: "inherit";
            };
            location: {
                /** @constant */
                mode: "unset";
            } | {
                /** @constant */
                mode: "unknown";
            } | {
                /** @constant */
                mode: "clear";
            } | {
                /** @constant */
                mode: "set";
                value: {
                    observation_id: string;
                    target_context_id: string;
                    model: "part" | "location";
                    /** Format: int64 */
                    pk: string;
                };
            } | {
                /** @constant */
                mode: "inherit";
            };
        };
        CaptureEdit: {
            /** Format: int64 */
            expected_revision: string;
            change: {
                /** @constant */
                kind: "batch";
                title?: string;
                archived?: boolean;
            } | {
                /** @constant */
                kind: "defaults";
                quantity?: {
                    /** @constant */
                    mode: "unset";
                } | {
                    /** @constant */
                    mode: "unknown";
                } | {
                    /** @constant */
                    mode: "clear";
                } | {
                    /** @constant */
                    mode: "set";
                    value: string;
                } | {
                    /** @constant */
                    mode: "inherit";
                };
                location?: {
                    /** @constant */
                    mode: "unset";
                } | {
                    /** @constant */
                    mode: "unknown";
                } | {
                    /** @constant */
                    mode: "clear";
                } | {
                    /** @constant */
                    mode: "set";
                    value: {
                        observation_id: string;
                        target_context_id: string;
                        model: "part" | "location";
                        /** Format: int64 */
                        pk: string;
                    };
                } | {
                    /** @constant */
                    mode: "inherit";
                };
            } | {
                /** @constant */
                kind: "add_part";
                label: string;
            } | {
                /** @constant */
                kind: "add_lot";
                label: string;
                note: string;
                part_subject_id: string | null;
            } | {
                /** @constant */
                kind: "lot";
                id: string;
                label?: string;
                part_subject_id?: string | null;
                quantity?: {
                    /** @constant */
                    mode: "unset";
                } | {
                    /** @constant */
                    mode: "unknown";
                } | {
                    /** @constant */
                    mode: "clear";
                } | {
                    /** @constant */
                    mode: "set";
                    value: string;
                } | {
                    /** @constant */
                    mode: "inherit";
                };
                location?: {
                    /** @constant */
                    mode: "unset";
                } | {
                    /** @constant */
                    mode: "unknown";
                } | {
                    /** @constant */
                    mode: "clear";
                } | {
                    /** @constant */
                    mode: "set";
                    value: {
                        observation_id: string;
                        target_context_id: string;
                        model: "part" | "location";
                        /** Format: int64 */
                        pk: string;
                    };
                } | {
                    /** @constant */
                    mode: "inherit";
                };
            } | {
                /** @constant */
                kind: "part";
                id: string;
                label?: string;
                choice?: {
                    /** @constant */
                    mode: "unset";
                } | {
                    /** @constant */
                    mode: "unknown";
                } | {
                    /** @constant */
                    mode: "clear";
                } | {
                    /** @constant */
                    mode: "set";
                    value: {
                        observation_id: string;
                        target_context_id: string;
                        model: "part" | "location";
                        /** Format: int64 */
                        pk: string;
                    };
                };
            } | {
                /** @constant */
                kind: "note";
                subject_id: string | null;
                text: string;
            };
        };
        CaptureObserve: {
            model: "part" | "location";
            /** Format: int64 */
            pk: string;
        };
        CaptureObservation: {
            id: string;
            model: "part" | "location";
            /** Format: int64 */
            pk: string;
            target_context_id: string;
            label: string;
            observed_at: string;
        };
        CaptureSummary: {
            id: string;
            source_id: string;
            title: string;
            /** Format: int64 */
            revision: string;
            archived: boolean;
            updated_at: string;
        };
        CaptureList: {
            batches: {
                id: string;
                source_id: string;
                title: string;
                /** Format: int64 */
                revision: string;
                archived: boolean;
                updated_at: string;
            }[];
            truncated: boolean;
        };
        CaptureSnapshot: {
            id: string;
            source_id: string;
            title: string;
            /** Format: int64 */
            revision: string;
            archived: boolean;
            updated_at: string;
            actor_id: string;
            target_context_id: string;
            defaults: {
                quantity: {
                    /** @constant */
                    mode: "unset";
                } | {
                    /** @constant */
                    mode: "unknown";
                } | {
                    /** @constant */
                    mode: "clear";
                } | {
                    /** @constant */
                    mode: "set";
                    value: string;
                } | {
                    /** @constant */
                    mode: "inherit";
                };
                location: {
                    /** @constant */
                    mode: "unset";
                } | {
                    /** @constant */
                    mode: "unknown";
                } | {
                    /** @constant */
                    mode: "clear";
                } | {
                    /** @constant */
                    mode: "set";
                    value: {
                        observation_id: string;
                        target_context_id: string;
                        model: "part" | "location";
                        /** Format: int64 */
                        pk: string;
                    };
                } | {
                    /** @constant */
                    mode: "inherit";
                };
            };
            parts: {
                id: string;
                label: string;
                /** Format: int64 */
                revision: string;
                choice: {
                    /** @constant */
                    mode: "unset";
                } | {
                    /** @constant */
                    mode: "unknown";
                } | {
                    /** @constant */
                    mode: "clear";
                } | {
                    /** @constant */
                    mode: "set";
                    value: {
                        observation_id: string;
                        target_context_id: string;
                        model: "part" | "location";
                        /** Format: int64 */
                        pk: string;
                    };
                };
            }[];
            lots: {
                id: string;
                label: string;
                /** Format: int64 */
                revision: string;
                contribution_key: string;
                part_subject_id: string | null;
                quantity: {
                    /** @constant */
                    mode: "unset";
                } | {
                    /** @constant */
                    mode: "unknown";
                } | {
                    /** @constant */
                    mode: "clear";
                } | {
                    /** @constant */
                    mode: "set";
                    value: string;
                } | {
                    /** @constant */
                    mode: "inherit";
                };
                location: {
                    /** @constant */
                    mode: "unset";
                } | {
                    /** @constant */
                    mode: "unknown";
                } | {
                    /** @constant */
                    mode: "clear";
                } | {
                    /** @constant */
                    mode: "set";
                    value: {
                        observation_id: string;
                        target_context_id: string;
                        model: "part" | "location";
                        /** Format: int64 */
                        pk: string;
                    };
                } | {
                    /** @constant */
                    mode: "inherit";
                };
            }[];
            notes: {
                id: string;
                subject_id: string | null;
                text: string;
                actor_id: string;
                created_at: string;
                /** @constant */
                producer: "human";
            }[];
            observations: {
                id: string;
                model: "part" | "location";
                /** Format: int64 */
                pk: string;
                target_context_id: string;
                label: string;
                observed_at: string;
            }[];
            cursor: {
                stream_id: string;
                sequence: string;
            };
        };
        ManualScope: {
            /** Format: int64 */
            expected_batch_revision: string;
            selected_lot_ids: string[];
        };
        ManualIssue: {
            code: string;
            message: string;
            lot_id: string | null;
            run_id: string | null;
        };
        ManualEffect: {
            lot_id: string;
            lot_label: string;
            /** Format: int64 */
            part_id: string;
            part_label: string;
            quantity: string;
            location_id: string | null;
            location_label: string;
            contribution_key: string;
            barcode: string;
        };
        ManualPreview: {
            id: string;
            batch_id: string;
            selected_lot_ids: string[];
            remaining_lot_ids: string[];
            plan_sha256: string;
            review_fingerprint: string;
            /** Format: int64 */
            target_revision: string;
            /** @constant */
            capability: "owned-fake-stock/1";
            effects: {
                lot_id: string;
                lot_label: string;
                /** Format: int64 */
                part_id: string;
                part_label: string;
                quantity: string;
                location_id: string | null;
                location_label: string;
                contribution_key: string;
                barcode: string;
            }[];
        };
        ManualPreparationResult: {
            /** @constant */
            status: "prepared";
            preparation: {
                id: string;
                batch_id: string;
                selected_lot_ids: string[];
                remaining_lot_ids: string[];
                plan_sha256: string;
                review_fingerprint: string;
                /** Format: int64 */
                target_revision: string;
                /** @constant */
                capability: "owned-fake-stock/1";
                effects: {
                    lot_id: string;
                    lot_label: string;
                    /** Format: int64 */
                    part_id: string;
                    part_label: string;
                    quantity: string;
                    location_id: string | null;
                    location_label: string;
                    contribution_key: string;
                    barcode: string;
                }[];
            };
        } | {
            /** @constant */
            status: "blocked";
            issues: {
                code: string;
                message: string;
                lot_id: string | null;
                run_id: string | null;
            }[];
        };
        ManualReviewResult: {
            reviewed_subject_ids: string[];
            cursor: {
                stream_id: string;
                /** Format: int64 */
                sequence: string;
            };
        };
        ManualAccepted: {
            run_id: string;
            approval_id: string;
            preparation_id: string;
        };
        ManualRunCommand: {
            /** Format: int64 */
            expected_run_revision: string;
        };
        ManualRecoveryCommand: {
            /** Format: int64 */
            expected_run_revision: string;
            operation_keys: string[];
        };
        ManualRun: {
            run_id: string;
            approval_id: string;
            preparation_id: string;
            batch_id: string;
            /** Format: int64 */
            revision: string;
            /** Format: int64 */
            round_number: string;
            state: "queued" | "running" | "stopping" | "settled_complete" | "settled_incomplete" | "recovery_required";
            effect_certainty: "none" | "confirmed" | "unknown" | "mixed";
            confirmed_stock_ids: string[];
            attributed_stock_ids: string[];
            cancellation_requested: boolean;
            dispatch_state: "not_requested" | "queued" | "running" | "finished" | "interrupted";
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
                /** Format: int64 */
                sequence: string;
            };
        };
        ManualWorkspace: {
            batch_id: string;
            /** Format: int64 */
            revision: string;
            supported: boolean;
            capability: "owned-fake-stock/1" | null;
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
                /** Format: int64 */
                revision: string;
                /** Format: int64 */
                round_number: string;
                state: "queued" | "running" | "stopping" | "settled_complete" | "settled_incomplete" | "recovery_required";
                effect_certainty: "none" | "confirmed" | "unknown" | "mixed";
                confirmed_stock_ids: string[];
                attributed_stock_ids: string[];
                cancellation_requested: boolean;
                dispatch_state: "not_requested" | "queued" | "running" | "finished" | "interrupted";
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
                    /** Format: int64 */
                    sequence: string;
                };
            }[];
            preparations: {
                id: string;
                batch_id: string;
                selected_lot_ids: string[];
                remaining_lot_ids: string[];
                plan_sha256: string;
                review_fingerprint: string;
                /** Format: int64 */
                target_revision: string;
                /** @constant */
                capability: "owned-fake-stock/1";
                effects: {
                    lot_id: string;
                    lot_label: string;
                    /** Format: int64 */
                    part_id: string;
                    part_label: string;
                    quantity: string;
                    location_id: string | null;
                    location_label: string;
                    contribution_key: string;
                    barcode: string;
                }[];
            }[];
            preparations_truncated: boolean;
            cursor: {
                stream_id: string;
                /** Format: int64 */
                sequence: string;
            };
        };
        ManualActivity: {
            runs: {
                batch_id: string;
                run_id: string;
                state: "queued" | "running" | "stopping" | "settled_complete" | "settled_incomplete" | "recovery_required";
            }[];
            truncated: boolean;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export type operations = Record<string, never>;

export type BatchCreate = components['schemas']['BatchCreate']
export type LotCreate = components['schemas']['LotCreate']
export type PartSelection = components['schemas']['PartSelection']
export type LotSelection = components['schemas']['LotSelection']
export type Preparation = components['schemas']['Preparation']
export type Approval = components['schemas']['Approval']
export type Cancellation = components['schemas']['Cancellation']
export type RunSnapshot = components['schemas']['RunSnapshot']
export type WorkerEnvelope = components['schemas']['WorkerEnvelope']
export type ErrorDto = components['schemas']['ErrorDto']
export type Bootstrap = components['schemas']['Bootstrap']
export type Health = components['schemas']['Health']
export type CaptureRef = components['schemas']['CaptureRef']
export type CaptureQuantity = components['schemas']['CaptureQuantity']
export type CaptureLocation = components['schemas']['CaptureLocation']
export type CapturePartChoice = components['schemas']['CapturePartChoice']
export type CaptureDefaults = components['schemas']['CaptureDefaults']
export type CaptureEdit = components['schemas']['CaptureEdit']
export type CaptureObserve = components['schemas']['CaptureObserve']
export type CaptureObservation = components['schemas']['CaptureObservation']
export type CaptureSummary = components['schemas']['CaptureSummary']
export type CaptureList = components['schemas']['CaptureList']
export type CaptureSnapshot = components['schemas']['CaptureSnapshot']
export type ManualScope = components['schemas']['ManualScope']
export type ManualIssue = components['schemas']['ManualIssue']
export type ManualEffect = components['schemas']['ManualEffect']
export type ManualPreview = components['schemas']['ManualPreview']
export type ManualPreparationResult = components['schemas']['ManualPreparationResult']
export type ManualReviewResult = components['schemas']['ManualReviewResult']
export type ManualAccepted = components['schemas']['ManualAccepted']
export type ManualRunCommand = components['schemas']['ManualRunCommand']
export type ManualRecoveryCommand = components['schemas']['ManualRecoveryCommand']
export type ManualRun = components['schemas']['ManualRun']
export type ManualWorkspace = components['schemas']['ManualWorkspace']
export type ManualActivity = components['schemas']['ManualActivity']
