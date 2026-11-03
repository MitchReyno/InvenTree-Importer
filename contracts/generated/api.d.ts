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
    "/api/v1/readiness": {
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
                /** @description Readiness */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Readiness"];
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
    "/api/v1/inbox": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    q?: string;
                    archived?: "include" | "exclude";
                    offset?: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description InboxList */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["InboxList"];
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
                query?: {
                    q?: string;
                    archived?: "include" | "exclude";
                    offset?: string;
                };
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
    "/api/v1/connection-status": {
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
                /** @description ConnectionStatus */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ConnectionStatus"];
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
    "/api/v1/header-work": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    batch_id?: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description HeaderWork */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["HeaderWork"];
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
    "/api/v1/agent-settings": {
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
                /** @description AgentSettings */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["AgentSettings"];
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
        put: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["AgentSettingsUpdate"];
                };
            };
            responses: {
                /** @description AgentSettings */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["AgentSettings"];
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
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/agent-sessions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    before?: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description AgentSessionList */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["AgentSessionList"];
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
    "/api/v1/processing-activity": {
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
                /** @description ProcessingActivity */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ProcessingActivity"];
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
    "/api/v1/batches/{id}/processing": {
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
                /** @description ProcessingSnapshot */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ProcessingSnapshot"];
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
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["ProcessingStart"];
                };
            };
            responses: {
                /** @description ProcessingReceipt */
                202: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ProcessingReceipt"];
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
    "/api/v1/batches/{id}/processing/{jobId}/cancellation": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
                jobId: string;
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
                    jobId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["ProcessingCancellation"];
                };
            };
            responses: {
                /** @description ProcessingReceipt */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ProcessingReceipt"];
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
    "/api/v1/batches/{id}/questions/{questionId}/answers": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
                questionId: string;
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
                    questionId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["ProcessingAnswer"];
                };
            };
            responses: {
                /** @description ProcessingAnswerReceipt */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ProcessingAnswerReceipt"];
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
    "/api/v1/batches/{batchId}/media": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                batchId: string;
            };
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    batchId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description MediaSnapshot */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["MediaSnapshot"];
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
    "/api/v1/batches/{batchId}/media/commands": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                batchId: string;
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
                    batchId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["MediaEdit"];
                };
            };
            responses: {
                /** @description MediaSnapshot */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["MediaSnapshot"];
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
    "/api/v1/batches/{batchId}/media/originals": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                batchId: string;
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header: {
                    "x-intake-media-revision": string;
                    /** @description Percent-encoded UTF-8 label, decoded and validated by the server. */
                    "x-intake-media-label": string;
                };
                path: {
                    batchId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/octet-stream": Blob;
                };
            };
            responses: {
                /** @description MediaReceipt */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["MediaReceipt"];
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
    "/api/v1/batches/{batchId}/media/versions/{resourceId}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                batchId: string;
                resourceId: string;
            };
            cookie?: never;
        };
        /** @description Private forced download; use a browser resource URL. */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    batchId: string;
                    resourceId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Private forced download; use a browser resource URL. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/octet-stream": Blob;
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
    "/api/v1/batches/{batchId}/media/previews/{resourceId}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                batchId: string;
                resourceId: string;
            };
            cookie?: never;
        };
        /** @description Private image preview; use a browser resource URL. */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    batchId: string;
                    resourceId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Private image preview; use a browser resource URL. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "image/png": Blob;
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
    "/api/v1/batches/{id}/operator-review": {
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
                /** @description OperatorReview */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["OperatorReview"];
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
    "/api/v1/batches/{id}/issue-dispositions": {
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
                    "application/json": components["schemas"]["IssueDisposition"];
                };
            };
            responses: {
                /** @description OperatorReview */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["OperatorReview"];
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
    "/api/v1/batches/{id}/bulk-edits": {
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
                    "application/json": components["schemas"]["BulkEdit"];
                };
            };
            responses: {
                /** @description BulkEditResult */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["BulkEditResult"];
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
    "/api/v1/batches/{id}/restructures": {
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
                    "application/json": components["schemas"]["Restructure"];
                };
            };
            responses: {
                /** @description RestructureResult */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["RestructureResult"];
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
    "/api/v1/batches/{id}/instructions": {
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
                    "application/json": components["schemas"]["InstructionEdit"];
                };
            };
            responses: {
                /** @description OperatorReview */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["OperatorReview"];
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
            media_enabled?: boolean;
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
        CaptureListQuery: {
            q?: string;
            archived?: "include" | "exclude";
            offset?: string;
        };
        InboxWorkflow: {
            lots: number;
            ready: number;
            needs_review: number;
            blocked: number;
            approved: number;
            open_questions: number;
            active_jobs: number;
            latest_round: null | {
                run_id: string;
                /** Format: int64 */
                round_number: string;
                state: string;
                confirmed_stock: number;
            };
            thumbnail: null | {
                preview_id: string;
                label: string;
            };
        };
        InboxList: {
            batches: {
                id: string;
                source_id: string;
                title: string;
                /** Format: int64 */
                revision: string;
                archived: boolean;
                updated_at: string;
                workflow: {
                    lots: number;
                    ready: number;
                    needs_review: number;
                    blocked: number;
                    approved: number;
                    open_questions: number;
                    active_jobs: number;
                    latest_round: null | {
                        run_id: string;
                        /** Format: int64 */
                        round_number: string;
                        state: string;
                        confirmed_stock: number;
                    };
                    thumbnail: null | {
                        preview_id: string;
                        label: string;
                    };
                };
            }[];
            truncated: boolean;
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
        } | {
            /** @constant */
            mode: "create";
            spec: {
                name: string;
                category: {
                    observation_id: string;
                    target_context_id: string;
                    /** @constant */
                    model: "category";
                    /** Format: int64 */
                    pk: string;
                };
                parameters: {
                    template: {
                        observation_id: string;
                        target_context_id: string;
                        /** @constant */
                        model: "parameter_template";
                        /** Format: int64 */
                        pk: string;
                    };
                    category_mapping: {
                        observation_id: string;
                        target_context_id: string;
                        /** @constant */
                        model: "category_parameter";
                        /** Format: int64 */
                        pk: string;
                    };
                    value: string;
                }[];
                manufacturer: null | {
                    company: {
                        observation_id: string;
                        target_context_id: string;
                        /** @constant */
                        model: "company";
                        /** Format: int64 */
                        pk: string;
                    };
                    mpn: string;
                };
                supplier: null | {
                    company: {
                        observation_id: string;
                        target_context_id: string;
                        /** @constant */
                        model: "company";
                        /** Format: int64 */
                        pk: string;
                    };
                    sku: string;
                };
                tags: string[];
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
        CaptureContext: {
            supplier: {
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
                    /** @constant */
                    model: "company";
                    /** Format: int64 */
                    pk: string;
                };
            };
            purchase_date: {
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
            };
            tags: {
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
                value: string[];
            };
        };
        CaptureLotContext: {
            supplier: {
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
                    /** @constant */
                    model: "company";
                    /** Format: int64 */
                    pk: string;
                };
            } | {
                /** @constant */
                mode: "inherit";
            };
            purchase_date: {
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
            tags: {
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
                value: string[];
            } | {
                /** @constant */
                mode: "inherit";
            };
        };
        CaptureContextRecord: {
            id: string;
            subject_id: string | null;
            /** Format: int64 */
            version: string;
            value: {
                supplier: {
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
                        /** @constant */
                        model: "company";
                        /** Format: int64 */
                        pk: string;
                    };
                } | {
                    /** @constant */
                    mode: "inherit";
                };
                purchase_date: {
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
                tags: {
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
                    value: string[];
                } | {
                    /** @constant */
                    mode: "inherit";
                };
            };
            actor_id: string;
            created_at: string;
        };
        CaptureEdit: {
            /** Format: int64 */
            expected_revision: string;
            change: {
                /** @constant */
                kind: "settings";
                title?: string;
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
                context?: {
                    supplier: {
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
                            /** @constant */
                            model: "company";
                            /** Format: int64 */
                            pk: string;
                        };
                    };
                    purchase_date: {
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
                    };
                    tags: {
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
                        value: string[];
                    };
                };
                note?: string;
                note_subject_id?: string | null;
            } | {
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
                context?: {
                    supplier: {
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
                            /** @constant */
                            model: "company";
                            /** Format: int64 */
                            pk: string;
                        };
                    } | {
                        /** @constant */
                        mode: "inherit";
                    };
                    purchase_date: {
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
                    tags: {
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
                        value: string[];
                    } | {
                        /** @constant */
                        mode: "inherit";
                    };
                };
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
                } | {
                    /** @constant */
                    mode: "create";
                    spec: {
                        name: string;
                        category: {
                            observation_id: string;
                            target_context_id: string;
                            /** @constant */
                            model: "category";
                            /** Format: int64 */
                            pk: string;
                        };
                        parameters: {
                            template: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "parameter_template";
                                /** Format: int64 */
                                pk: string;
                            };
                            category_mapping: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "category_parameter";
                                /** Format: int64 */
                                pk: string;
                            };
                            value: string;
                        }[];
                        manufacturer: null | {
                            company: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "company";
                                /** Format: int64 */
                                pk: string;
                            };
                            mpn: string;
                        };
                        supplier: null | {
                            company: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "company";
                                /** Format: int64 */
                                pk: string;
                            };
                            sku: string;
                        };
                        tags: string[];
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
            model: "part" | "location" | "category" | "parameter_template" | "category_parameter" | "company";
            /** Format: int64 */
            pk: string;
        };
        CaptureObservation: {
            id: string;
            model: "part" | "location" | "category" | "parameter_template" | "category_parameter" | "company";
            mapping?: {
                /** @constant */
                kind: "category";
            } | {
                /** @constant */
                kind: "parameter_template";
                model_type: "part.part" | null;
                enabled: boolean;
            } | {
                /** @constant */
                kind: "category_parameter";
                /** Format: int64 */
                category_id: string;
                /** Format: int64 */
                template_id: string;
            } | {
                /** @constant */
                kind: "company";
                manufacturer: boolean;
                supplier: boolean;
            };
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
            context?: {
                id: string;
                subject_id: string | null;
                /** Format: int64 */
                version: string;
                value: {
                    supplier: {
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
                            /** @constant */
                            model: "company";
                            /** Format: int64 */
                            pk: string;
                        };
                    } | {
                        /** @constant */
                        mode: "inherit";
                    };
                    purchase_date: {
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
                    tags: {
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
                        value: string[];
                    } | {
                        /** @constant */
                        mode: "inherit";
                    };
                };
                actor_id: string;
                created_at: string;
            }[];
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
                } | {
                    /** @constant */
                    mode: "create";
                    spec: {
                        name: string;
                        category: {
                            observation_id: string;
                            target_context_id: string;
                            /** @constant */
                            model: "category";
                            /** Format: int64 */
                            pk: string;
                        };
                        parameters: {
                            template: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "parameter_template";
                                /** Format: int64 */
                                pk: string;
                            };
                            category_mapping: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "category_parameter";
                                /** Format: int64 */
                                pk: string;
                            };
                            value: string;
                        }[];
                        manufacturer: null | {
                            company: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "company";
                                /** Format: int64 */
                                pk: string;
                            };
                            mpn: string;
                        };
                        supplier: null | {
                            company: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "company";
                                /** Format: int64 */
                                pk: string;
                            };
                            sku: string;
                        };
                        tags: string[];
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
                /** @constant */
                retired?: true;
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
                model: "part" | "location" | "category" | "parameter_template" | "category_parameter" | "company";
                mapping?: {
                    /** @constant */
                    kind: "category";
                } | {
                    /** @constant */
                    kind: "parameter_template";
                    model_type: "part.part" | null;
                    enabled: boolean;
                } | {
                    /** @constant */
                    kind: "category_parameter";
                    /** Format: int64 */
                    category_id: string;
                    /** Format: int64 */
                    template_id: string;
                } | {
                    /** @constant */
                    kind: "company";
                    manufacturer: boolean;
                    supplier: boolean;
                };
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
        ConnectionStatus: {
            actor_id: string;
            target_id: string;
            target_context_id: string;
            target: {
                state: "unconfigured" | "unknown" | "reachable" | "unavailable";
                freshness: "unobserved" | "fresh" | "stale";
                observed_at: string | null;
                failure_code: ("invalid_configuration" | "timeout" | "http_error" | "redirect_refused" | "unexpected_response" | "unavailable") | null;
                navigation_url: string | null;
                label: string | null;
            };
        };
        HeaderWorkQuery: {
            batch_id?: string;
        };
        HeaderWork: {
            actor_id: string;
            target_id: string;
            target_context_id: string;
            observed_at: string;
            work: ({
                /** @constant */
                kind: "processing";
                id: string;
                batch_id: string;
                attempt_id: string;
                stage: "reading" | "identifying" | "research" | "images" | "inventory";
                state: "queued" | "running" | "waiting_for_user" | "waiting_for_login" | "waiting_for_capacity" | "ready" | "failed" | "cancelled" | "superseded" | "interrupted";
                input_current: boolean | null;
                occupies_lane: boolean;
                blocked_code: ("media_not_ready" | "media_input_capacity" | "worker_version_conflict") | null;
                steps: {
                    stage: "reading" | "identifying" | "research" | "images" | "inventory";
                    state: "queued" | "running" | "waiting_for_user" | "waiting_for_login" | "waiting_for_capacity" | "ready" | "failed" | "cancelled" | "superseded" | "interrupted";
                }[];
                steps_complete: boolean;
            } | {
                /** @constant */
                kind: "import";
                id: string;
                batch_id: string;
                /** @constant */
                stage: "inventory";
                state: "queued" | "running" | "stopping" | "settled_complete" | "settled_incomplete" | "recovery_required";
                steps: {
                    name: "approval" | "dispatch" | "inventory";
                    state: "confirmed" | "not_requested" | "queued" | "running" | "finished" | "interrupted" | "none" | "unknown" | "mixed";
                }[];
                steps_complete: boolean;
            })[];
            active_sessions: {
                attempt_id: string;
                batch_id: string;
                job_id: string;
                stage: "reading" | "identifying" | "research" | "images" | "inventory";
                state: "queued" | "running" | "waiting_for_user" | "waiting_for_login" | "waiting_for_capacity" | "ready" | "failed" | "cancelled" | "superseded" | "interrupted";
                selection: {
                    provider: "codex" | "claude";
                    authentication: "api_key" | "subscription";
                    model: string;
                };
                actual_model: string | null;
                progress: "queued" | "starting" | "responding" | "settled";
                occupies_lane: boolean;
            }[];
            work_truncated: boolean;
            sessions_truncated: boolean;
            lane_occupied: boolean;
        };
        InventoryModel: "part" | "location" | "category" | "parameter_template" | "category_parameter" | "company";
        InventoryPartSpec: {
            name: string;
            category: {
                observation_id: string;
                target_context_id: string;
                /** @constant */
                model: "category";
                /** Format: int64 */
                pk: string;
            };
            parameters: {
                template: {
                    observation_id: string;
                    target_context_id: string;
                    /** @constant */
                    model: "parameter_template";
                    /** Format: int64 */
                    pk: string;
                };
                category_mapping: {
                    observation_id: string;
                    target_context_id: string;
                    /** @constant */
                    model: "category_parameter";
                    /** Format: int64 */
                    pk: string;
                };
                value: string;
            }[];
            manufacturer: null | {
                company: {
                    observation_id: string;
                    target_context_id: string;
                    /** @constant */
                    model: "company";
                    /** Format: int64 */
                    pk: string;
                };
                mpn: string;
            };
            supplier: null | {
                company: {
                    observation_id: string;
                    target_context_id: string;
                    /** @constant */
                    model: "company";
                    /** Format: int64 */
                    pk: string;
                };
                sku: string;
            };
            tags: string[];
        };
        InventoryMapping: {
            /** @constant */
            kind: "category";
        } | {
            /** @constant */
            kind: "parameter_template";
            model_type: "part.part" | null;
            enabled: boolean;
        } | {
            /** @constant */
            kind: "category_parameter";
            /** Format: int64 */
            category_id: string;
            /** Format: int64 */
            template_id: string;
        } | {
            /** @constant */
            kind: "company";
            manufacturer: boolean;
            supplier: boolean;
        };
        SupportedEffectKind: "create_stock" | "create_part" | "parameter" | "manufacturer" | "supplier" | "part_attachment";
        SupportedEffectPreview: {
            operation_key: string;
            part_subject_id: string;
            kind: "create_stock" | "create_part" | "parameter" | "manufacturer" | "supplier" | "part_attachment";
            label: string;
            dependencies: string[];
            inputs: {
                [key: string]: string;
            };
        };
        PartOutput: {
            label: string;
            operation_key: string;
            part_subject_id: string;
            spec_sha256: string;
            certainty: "none" | "unknown" | "confirmed";
            remote_pks: string[];
            usable: boolean;
            verification: null | "matches" | "missing_or_changed" | "unavailable";
        };
        SupportedEffectResult: {
            operation_key: string;
            part_subject_id: string;
            kind: "create_stock" | "create_part" | "parameter" | "manufacturer" | "supplier" | "part_attachment";
            label: string;
            dependencies: string[];
            inputs: {
                [key: string]: string;
            };
            certainty: "none" | "unknown" | "confirmed";
            remote_pks: string[];
            verification: null | "matches" | "missing_or_changed" | "unavailable";
            recovery_action: null | "resume_effect" | "verify_effect";
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
            part_label: string;
            quantity: string;
            location_id: string | null;
            location_label: string;
            contribution_key: string;
            barcode: string;
            /** Format: int64 */
            part_id: string;
        } | {
            lot_id: string;
            lot_label: string;
            part_label: string;
            quantity: string;
            location_id: string | null;
            location_label: string;
            contribution_key: string;
            barcode: string;
            part_id: null;
            part_operation_key: string;
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
            capability: "owned-fake-stock/1" | "owned-fake-media/1" | "owned-fake-effects/1";
            attachments?: {
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
                /** @constant */
                destination: "stock_attachment";
            }[];
            part_attachments?: ({
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
                part_subject_id: string;
                part_label: string;
                /** @constant */
                destination: "part_attachment";
                prior_run_id: string | null;
                prior_remote_pk: string | null;
                /** Format: int64 */
                part_id: string;
            } | {
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
                part_subject_id: string;
                part_label: string;
                /** @constant */
                destination: "part_attachment";
                prior_run_id: string | null;
                prior_remote_pk: string | null;
                part_id: null;
                part_operation_key: string;
            })[];
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
            supported_effects?: {
                operation_key: string;
                part_subject_id: string;
                kind: "create_stock" | "create_part" | "parameter" | "manufacturer" | "supplier" | "part_attachment";
                label: string;
                dependencies: string[];
                inputs: {
                    [key: string]: string;
                };
            }[];
            effects: ({
                lot_id: string;
                lot_label: string;
                part_label: string;
                quantity: string;
                location_id: string | null;
                location_label: string;
                contribution_key: string;
                barcode: string;
                /** Format: int64 */
                part_id: string;
            } | {
                lot_id: string;
                lot_label: string;
                part_label: string;
                quantity: string;
                location_id: string | null;
                location_label: string;
                contribution_key: string;
                barcode: string;
                part_id: null;
                part_operation_key: string;
            })[];
        };
        ManualAttachment: {
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
            /** @constant */
            destination: "stock_attachment";
        };
        ManualPartAttachment: {
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
            part_subject_id: string;
            part_label: string;
            /** @constant */
            destination: "part_attachment";
            prior_run_id: string | null;
            prior_remote_pk: string | null;
            /** Format: int64 */
            part_id: string;
        } | {
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
            part_subject_id: string;
            part_label: string;
            /** @constant */
            destination: "part_attachment";
            prior_run_id: string | null;
            prior_remote_pk: string | null;
            part_id: null;
            part_operation_key: string;
        };
        ManualMediaEvidence: {
            version_id: string;
            evidence_id: string;
            blob_sha256: string;
            byte_size: string;
            media_type: "image/jpeg" | "image/png" | "application/pdf";
            kind: "original" | "derived";
            original_version_id: string;
            original_sha256: string;
            recipe_sha256: string | null;
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
                capability: "owned-fake-stock/1" | "owned-fake-media/1" | "owned-fake-effects/1";
                attachments?: {
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
                    /** @constant */
                    destination: "stock_attachment";
                }[];
                part_attachments?: ({
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
                    part_subject_id: string;
                    part_label: string;
                    /** @constant */
                    destination: "part_attachment";
                    prior_run_id: string | null;
                    prior_remote_pk: string | null;
                    /** Format: int64 */
                    part_id: string;
                } | {
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
                    part_subject_id: string;
                    part_label: string;
                    /** @constant */
                    destination: "part_attachment";
                    prior_run_id: string | null;
                    prior_remote_pk: string | null;
                    part_id: null;
                    part_operation_key: string;
                })[];
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
                supported_effects?: {
                    operation_key: string;
                    part_subject_id: string;
                    kind: "create_stock" | "create_part" | "parameter" | "manufacturer" | "supplier" | "part_attachment";
                    label: string;
                    dependencies: string[];
                    inputs: {
                        [key: string]: string;
                    };
                }[];
                effects: ({
                    lot_id: string;
                    lot_label: string;
                    part_label: string;
                    quantity: string;
                    location_id: string | null;
                    location_label: string;
                    contribution_key: string;
                    barcode: string;
                    /** Format: int64 */
                    part_id: string;
                } | {
                    lot_id: string;
                    lot_label: string;
                    part_label: string;
                    quantity: string;
                    location_id: string | null;
                    location_label: string;
                    contribution_key: string;
                    barcode: string;
                    part_id: null;
                    part_operation_key: string;
                })[];
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
        } | {
            /** Format: int64 */
            expected_run_revision: string;
            attachment_keys: string[];
        } | {
            /** Format: int64 */
            expected_run_revision: string;
            effect_keys: string[];
        } | {
            /** Format: int64 */
            expected_run_revision: string;
            assessment_keys: string[];
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
            part_attachments?: ({
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
                part_subject_id: string;
                part_label: string;
                /** @constant */
                destination: "part_attachment";
                prior_run_id: string | null;
                prior_remote_pk: string | null;
                /** Format: int64 */
                part_id: string;
            } | {
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
                part_subject_id: string;
                part_label: string;
                /** @constant */
                destination: "part_attachment";
                prior_run_id: string | null;
                prior_remote_pk: string | null;
                part_id: null;
                part_operation_key: string;
            })[];
            part_outputs?: {
                label: string;
                operation_key: string;
                part_subject_id: string;
                spec_sha256: string;
                certainty: "none" | "unknown" | "confirmed";
                remote_pks: string[];
                usable: boolean;
                verification: null | "matches" | "missing_or_changed" | "unavailable";
            }[];
            supported_effects?: {
                operation_key: string;
                part_subject_id: string;
                kind: "create_stock" | "create_part" | "parameter" | "manufacturer" | "supplier" | "part_attachment";
                label: string;
                dependencies: string[];
                inputs: {
                    [key: string]: string;
                };
                certainty: "none" | "unknown" | "confirmed";
                remote_pks: string[];
                verification: null | "matches" | "missing_or_changed" | "unavailable";
                recovery_action: null | "resume_effect" | "verify_effect";
            }[];
            confirmed_stock_ids: string[];
            attributed_stock_ids: string[];
            cancellation_requested: boolean;
            dispatch_state: "not_requested" | "queued" | "running" | "finished" | "interrupted";
            attachments?: {
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
            }[];
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
            capability: ("owned-fake-stock/1" | "owned-fake-media/1" | "owned-fake-effects/1") | null;
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
                part_attachments?: ({
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
                    part_subject_id: string;
                    part_label: string;
                    /** @constant */
                    destination: "part_attachment";
                    prior_run_id: string | null;
                    prior_remote_pk: string | null;
                    /** Format: int64 */
                    part_id: string;
                } | {
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
                    part_subject_id: string;
                    part_label: string;
                    /** @constant */
                    destination: "part_attachment";
                    prior_run_id: string | null;
                    prior_remote_pk: string | null;
                    part_id: null;
                    part_operation_key: string;
                })[];
                part_outputs?: {
                    label: string;
                    operation_key: string;
                    part_subject_id: string;
                    spec_sha256: string;
                    certainty: "none" | "unknown" | "confirmed";
                    remote_pks: string[];
                    usable: boolean;
                    verification: null | "matches" | "missing_or_changed" | "unavailable";
                }[];
                supported_effects?: {
                    operation_key: string;
                    part_subject_id: string;
                    kind: "create_stock" | "create_part" | "parameter" | "manufacturer" | "supplier" | "part_attachment";
                    label: string;
                    dependencies: string[];
                    inputs: {
                        [key: string]: string;
                    };
                    certainty: "none" | "unknown" | "confirmed";
                    remote_pks: string[];
                    verification: null | "matches" | "missing_or_changed" | "unavailable";
                    recovery_action: null | "resume_effect" | "verify_effect";
                }[];
                confirmed_stock_ids: string[];
                attributed_stock_ids: string[];
                cancellation_requested: boolean;
                dispatch_state: "not_requested" | "queued" | "running" | "finished" | "interrupted";
                attachments?: {
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
                }[];
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
                capability: "owned-fake-stock/1" | "owned-fake-media/1" | "owned-fake-effects/1";
                attachments?: {
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
                    /** @constant */
                    destination: "stock_attachment";
                }[];
                part_attachments?: ({
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
                    part_subject_id: string;
                    part_label: string;
                    /** @constant */
                    destination: "part_attachment";
                    prior_run_id: string | null;
                    prior_remote_pk: string | null;
                    /** Format: int64 */
                    part_id: string;
                } | {
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
                    part_subject_id: string;
                    part_label: string;
                    /** @constant */
                    destination: "part_attachment";
                    prior_run_id: string | null;
                    prior_remote_pk: string | null;
                    part_id: null;
                    part_operation_key: string;
                })[];
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
                supported_effects?: {
                    operation_key: string;
                    part_subject_id: string;
                    kind: "create_stock" | "create_part" | "parameter" | "manufacturer" | "supplier" | "part_attachment";
                    label: string;
                    dependencies: string[];
                    inputs: {
                        [key: string]: string;
                    };
                }[];
                effects: ({
                    lot_id: string;
                    lot_label: string;
                    part_label: string;
                    quantity: string;
                    location_id: string | null;
                    location_label: string;
                    contribution_key: string;
                    barcode: string;
                    /** Format: int64 */
                    part_id: string;
                } | {
                    lot_id: string;
                    lot_label: string;
                    part_label: string;
                    quantity: string;
                    location_id: string | null;
                    location_label: string;
                    contribution_key: string;
                    barcode: string;
                    part_id: null;
                    part_operation_key: string;
                })[];
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
        ProcessingInputV4: {
            /** @constant */
            schema_version: "bench-intake-input/4";
            batch_id: string;
            source_id: string;
            /** Format: int64 */
            capture_revision: string;
            subject_id: string;
            stage: "reading" | "identifying" | "research" | "images" | "inventory";
            dependencies: string[];
            answer_id: string | null;
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
            subject: {
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
                /** @constant */
                retired?: true;
            } | {
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
                } | {
                    /** @constant */
                    mode: "create";
                    spec: {
                        name: string;
                        category: {
                            observation_id: string;
                            target_context_id: string;
                            /** @constant */
                            model: "category";
                            /** Format: int64 */
                            pk: string;
                        };
                        parameters: {
                            template: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "parameter_template";
                                /** Format: int64 */
                                pk: string;
                            };
                            category_mapping: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "category_parameter";
                                /** Format: int64 */
                                pk: string;
                            };
                            value: string;
                        }[];
                        manufacturer: null | {
                            company: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "company";
                                /** Format: int64 */
                                pk: string;
                            };
                            mpn: string;
                        };
                        supplier: null | {
                            company: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "company";
                                /** Format: int64 */
                                pk: string;
                            };
                            sku: string;
                        };
                        tags: string[];
                    };
                };
            };
            linked_part: {
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
                } | {
                    /** @constant */
                    mode: "create";
                    spec: {
                        name: string;
                        category: {
                            observation_id: string;
                            target_context_id: string;
                            /** @constant */
                            model: "category";
                            /** Format: int64 */
                            pk: string;
                        };
                        parameters: {
                            template: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "parameter_template";
                                /** Format: int64 */
                                pk: string;
                            };
                            category_mapping: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "category_parameter";
                                /** Format: int64 */
                                pk: string;
                            };
                            value: string;
                        }[];
                        manufacturer: null | {
                            company: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "company";
                                /** Format: int64 */
                                pk: string;
                            };
                            mpn: string;
                        };
                        supplier: null | {
                            company: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "company";
                                /** Format: int64 */
                                pk: string;
                            };
                            sku: string;
                        };
                        tags: string[];
                    };
                };
            } | null;
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
                model: "part" | "location" | "category" | "parameter_template" | "category_parameter" | "company";
                mapping?: {
                    /** @constant */
                    kind: "category";
                } | {
                    /** @constant */
                    kind: "parameter_template";
                    model_type: "part.part" | null;
                    enabled: boolean;
                } | {
                    /** @constant */
                    kind: "category_parameter";
                    /** Format: int64 */
                    category_id: string;
                    /** Format: int64 */
                    template_id: string;
                } | {
                    /** @constant */
                    kind: "company";
                    manufacturer: boolean;
                    supplier: boolean;
                };
                /** Format: int64 */
                pk: string;
                target_context_id: string;
                label: string;
                observed_at: string;
            }[];
            /** @constant */
            profile_id: "native-agent/1";
            /** @constant */
            instruction_version: "native-agent/1";
            instruction_sha256: string;
            /** @constant */
            tool_profile_version: "native-no-tools/1";
            media: {
                manifest: string;
                sha256: string;
            };
            agent: {
                provider: "codex" | "claude";
                authentication: "api_key" | "subscription";
                model: string;
            };
            /** Format: int64 */
            settings_revision: string;
        };
        ProcessingCommandV4: {
            /** @constant */
            schema_version: "bench-intake-processing-command/4";
            job_id: string;
            attempt_id: string;
            input_id: string;
            input_sha256: string;
            /** @constant */
            profile_id: "native-agent/1";
            /** @constant */
            handler_version: "processing/4";
            command_id: string;
        };
        ProcessingEnvelopeV4: {
            /** @constant */
            schema_version: "bench-intake-runner/4";
            job_id: string;
            attempt_id: string;
            command_id: string;
            input_sha256: string;
            /** @constant */
            profile_id: "native-agent/1";
            /** @constant */
            handler_version: "processing/4";
            /** Format: int64 */
            sequence: string;
            /** @constant */
            kind: "proposal";
            payload: {
                /** @constant */
                schema_version: "bench-intake-proposal/2";
                subject_id: string;
                summary: string;
                sources: ({
                    /** @constant */
                    kind: "note";
                    note_id: string;
                    text_sha256: string;
                } | {
                    /** @constant */
                    kind: "media_version";
                    evidence_id: string;
                    version_id: string;
                    sha256: string;
                })[];
            };
        } | {
            /** @constant */
            schema_version: "bench-intake-runner/4";
            job_id: string;
            attempt_id: string;
            command_id: string;
            input_sha256: string;
            /** @constant */
            profile_id: "native-agent/1";
            /** @constant */
            handler_version: "processing/4";
            /** Format: int64 */
            sequence: string;
            /** @constant */
            kind: "question";
            payload: {
                kind: "quantity" | "clarification";
                subject_id: string;
                prompt: string;
                reason: string;
            };
        } | {
            /** @constant */
            schema_version: "bench-intake-runner/4";
            job_id: string;
            attempt_id: string;
            command_id: string;
            input_sha256: string;
            /** @constant */
            profile_id: "native-agent/1";
            /** @constant */
            handler_version: "processing/4";
            /** Format: int64 */
            sequence: string;
            /** @constant */
            kind: "terminal";
            payload: {
                state: "ready" | "failed" | "waiting_for_login" | "waiting_for_capacity" | "interrupted";
            };
        };
        ProcessingInputV1: {
            /** @constant */
            schema_version: "bench-intake-input/1";
            batch_id: string;
            source_id: string;
            /** Format: int64 */
            capture_revision: string;
            subject_id: string;
            stage: "reading" | "identifying" | "research" | "images" | "inventory";
            dependencies: string[];
            answer_id: string | null;
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
            subject: {
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
                /** @constant */
                retired?: true;
            } | {
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
                } | {
                    /** @constant */
                    mode: "create";
                    spec: {
                        name: string;
                        category: {
                            observation_id: string;
                            target_context_id: string;
                            /** @constant */
                            model: "category";
                            /** Format: int64 */
                            pk: string;
                        };
                        parameters: {
                            template: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "parameter_template";
                                /** Format: int64 */
                                pk: string;
                            };
                            category_mapping: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "category_parameter";
                                /** Format: int64 */
                                pk: string;
                            };
                            value: string;
                        }[];
                        manufacturer: null | {
                            company: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "company";
                                /** Format: int64 */
                                pk: string;
                            };
                            mpn: string;
                        };
                        supplier: null | {
                            company: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "company";
                                /** Format: int64 */
                                pk: string;
                            };
                            sku: string;
                        };
                        tags: string[];
                    };
                };
            };
            linked_part: {
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
                } | {
                    /** @constant */
                    mode: "create";
                    spec: {
                        name: string;
                        category: {
                            observation_id: string;
                            target_context_id: string;
                            /** @constant */
                            model: "category";
                            /** Format: int64 */
                            pk: string;
                        };
                        parameters: {
                            template: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "parameter_template";
                                /** Format: int64 */
                                pk: string;
                            };
                            category_mapping: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "category_parameter";
                                /** Format: int64 */
                                pk: string;
                            };
                            value: string;
                        }[];
                        manufacturer: null | {
                            company: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "company";
                                /** Format: int64 */
                                pk: string;
                            };
                            mpn: string;
                        };
                        supplier: null | {
                            company: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "company";
                                /** Format: int64 */
                                pk: string;
                            };
                            sku: string;
                        };
                        tags: string[];
                    };
                };
            } | null;
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
                model: "part" | "location" | "category" | "parameter_template" | "category_parameter" | "company";
                mapping?: {
                    /** @constant */
                    kind: "category";
                } | {
                    /** @constant */
                    kind: "parameter_template";
                    model_type: "part.part" | null;
                    enabled: boolean;
                } | {
                    /** @constant */
                    kind: "category_parameter";
                    /** Format: int64 */
                    category_id: string;
                    /** Format: int64 */
                    template_id: string;
                } | {
                    /** @constant */
                    kind: "company";
                    manufacturer: boolean;
                    supplier: boolean;
                };
                /** Format: int64 */
                pk: string;
                target_context_id: string;
                label: string;
                observed_at: string;
            }[];
            /** @constant */
            profile_id: "synthetic-research/1";
            /** @constant */
            instruction_version: "restricted-synthetic/1";
            instruction_sha256: string;
            /** @constant */
            tool_profile_version: "restricted-no-tools/1";
            media: string[];
        };
        ProcessingInputV2: {
            /** @constant */
            schema_version: "bench-intake-input/2";
            batch_id: string;
            source_id: string;
            /** Format: int64 */
            capture_revision: string;
            subject_id: string;
            stage: "reading" | "identifying" | "research" | "images" | "inventory";
            dependencies: string[];
            answer_id: string | null;
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
            subject: {
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
                /** @constant */
                retired?: true;
            } | {
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
                } | {
                    /** @constant */
                    mode: "create";
                    spec: {
                        name: string;
                        category: {
                            observation_id: string;
                            target_context_id: string;
                            /** @constant */
                            model: "category";
                            /** Format: int64 */
                            pk: string;
                        };
                        parameters: {
                            template: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "parameter_template";
                                /** Format: int64 */
                                pk: string;
                            };
                            category_mapping: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "category_parameter";
                                /** Format: int64 */
                                pk: string;
                            };
                            value: string;
                        }[];
                        manufacturer: null | {
                            company: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "company";
                                /** Format: int64 */
                                pk: string;
                            };
                            mpn: string;
                        };
                        supplier: null | {
                            company: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "company";
                                /** Format: int64 */
                                pk: string;
                            };
                            sku: string;
                        };
                        tags: string[];
                    };
                };
            };
            linked_part: {
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
                } | {
                    /** @constant */
                    mode: "create";
                    spec: {
                        name: string;
                        category: {
                            observation_id: string;
                            target_context_id: string;
                            /** @constant */
                            model: "category";
                            /** Format: int64 */
                            pk: string;
                        };
                        parameters: {
                            template: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "parameter_template";
                                /** Format: int64 */
                                pk: string;
                            };
                            category_mapping: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "category_parameter";
                                /** Format: int64 */
                                pk: string;
                            };
                            value: string;
                        }[];
                        manufacturer: null | {
                            company: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "company";
                                /** Format: int64 */
                                pk: string;
                            };
                            mpn: string;
                        };
                        supplier: null | {
                            company: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "company";
                                /** Format: int64 */
                                pk: string;
                            };
                            sku: string;
                        };
                        tags: string[];
                    };
                };
            } | null;
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
                model: "part" | "location" | "category" | "parameter_template" | "category_parameter" | "company";
                mapping?: {
                    /** @constant */
                    kind: "category";
                } | {
                    /** @constant */
                    kind: "parameter_template";
                    model_type: "part.part" | null;
                    enabled: boolean;
                } | {
                    /** @constant */
                    kind: "category_parameter";
                    /** Format: int64 */
                    category_id: string;
                    /** Format: int64 */
                    template_id: string;
                } | {
                    /** @constant */
                    kind: "company";
                    manufacturer: boolean;
                    supplier: boolean;
                };
                /** Format: int64 */
                pk: string;
                target_context_id: string;
                label: string;
                observed_at: string;
            }[];
            /** @constant */
            profile_id: "synthetic-research/2";
            /** @constant */
            instruction_version: "restricted-synthetic/2";
            instruction_sha256: string;
            /** @constant */
            tool_profile_version: "restricted-no-tools/1";
            media: {
                manifest: string;
                sha256: string;
            };
        };
        ProcessingInputV3: {
            /** @constant */
            schema_version: "bench-intake-input/3";
            batch_id: string;
            source_id: string;
            /** Format: int64 */
            capture_revision: string;
            subject_id: string;
            stage: "reading" | "identifying" | "research" | "images" | "inventory";
            dependencies: string[];
            answer_id: string | null;
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
            subject: {
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
                /** @constant */
                retired?: true;
            } | {
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
                } | {
                    /** @constant */
                    mode: "create";
                    spec: {
                        name: string;
                        category: {
                            observation_id: string;
                            target_context_id: string;
                            /** @constant */
                            model: "category";
                            /** Format: int64 */
                            pk: string;
                        };
                        parameters: {
                            template: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "parameter_template";
                                /** Format: int64 */
                                pk: string;
                            };
                            category_mapping: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "category_parameter";
                                /** Format: int64 */
                                pk: string;
                            };
                            value: string;
                        }[];
                        manufacturer: null | {
                            company: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "company";
                                /** Format: int64 */
                                pk: string;
                            };
                            mpn: string;
                        };
                        supplier: null | {
                            company: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "company";
                                /** Format: int64 */
                                pk: string;
                            };
                            sku: string;
                        };
                        tags: string[];
                    };
                };
            };
            linked_part: {
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
                } | {
                    /** @constant */
                    mode: "create";
                    spec: {
                        name: string;
                        category: {
                            observation_id: string;
                            target_context_id: string;
                            /** @constant */
                            model: "category";
                            /** Format: int64 */
                            pk: string;
                        };
                        parameters: {
                            template: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "parameter_template";
                                /** Format: int64 */
                                pk: string;
                            };
                            category_mapping: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "category_parameter";
                                /** Format: int64 */
                                pk: string;
                            };
                            value: string;
                        }[];
                        manufacturer: null | {
                            company: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "company";
                                /** Format: int64 */
                                pk: string;
                            };
                            mpn: string;
                        };
                        supplier: null | {
                            company: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "company";
                                /** Format: int64 */
                                pk: string;
                            };
                            sku: string;
                        };
                        tags: string[];
                    };
                };
            } | null;
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
                model: "part" | "location" | "category" | "parameter_template" | "category_parameter" | "company";
                mapping?: {
                    /** @constant */
                    kind: "category";
                } | {
                    /** @constant */
                    kind: "parameter_template";
                    model_type: "part.part" | null;
                    enabled: boolean;
                } | {
                    /** @constant */
                    kind: "category_parameter";
                    /** Format: int64 */
                    category_id: string;
                    /** Format: int64 */
                    template_id: string;
                } | {
                    /** @constant */
                    kind: "company";
                    manufacturer: boolean;
                    supplier: boolean;
                };
                /** Format: int64 */
                pk: string;
                target_context_id: string;
                label: string;
                observed_at: string;
            }[];
            /** @constant */
            profile_id: "restricted-research-stub/1";
            /** @constant */
            instruction_version: "restricted-research-stub/1";
            instruction_sha256: string;
            /** @constant */
            tool_profile_version: "restricted-research-tools/1";
            media: {
                manifest: string;
                sha256: string;
            };
            source_urls: string[];
        };
        ProcessingCommandV1: {
            /** @constant */
            schema_version: "bench-intake-processing-command/1";
            job_id: string;
            attempt_id: string;
            input_id: string;
            input_sha256: string;
            /** @constant */
            profile_id: "synthetic-research/1";
            /** @constant */
            handler_version: "processing/1";
            command_id: string;
        };
        ProcessingCommandV2: {
            /** @constant */
            schema_version: "bench-intake-processing-command/2";
            job_id: string;
            attempt_id: string;
            input_id: string;
            input_sha256: string;
            /** @constant */
            profile_id: "synthetic-research/2";
            /** @constant */
            handler_version: "processing/2";
            command_id: string;
        };
        ProcessingCommandV3: {
            /** @constant */
            schema_version: "bench-intake-processing-command/3";
            job_id: string;
            attempt_id: string;
            input_id: string;
            input_sha256: string;
            /** @constant */
            profile_id: "restricted-research-stub/1";
            /** @constant */
            handler_version: "processing/3";
            command_id: string;
        };
        ProcessingProposalV1: {
            subject_id: string;
            summary: string;
            source_note_ids: string[];
        };
        ProcessingProposalV2: {
            /** @constant */
            schema_version: "bench-intake-proposal/2";
            subject_id: string;
            summary: string;
            sources: ({
                /** @constant */
                kind: "note";
                note_id: string;
                text_sha256: string;
            } | {
                /** @constant */
                kind: "media_version";
                evidence_id: string;
                version_id: string;
                sha256: string;
            })[];
        };
        ProcessingProposalV3: {
            /** @constant */
            schema_version: "bench-intake-proposal/3";
            subject_id: string;
            summary: string;
            sources: (({
                /** @constant */
                kind: "note";
                note_id: string;
                text_sha256: string;
            } | {
                /** @constant */
                kind: "media_version";
                evidence_id: string;
                version_id: string;
                sha256: string;
            }) | {
                /** @constant */
                kind: "research_receipt";
                receipt_id: string;
                sha256: string;
            })[];
        };
        ProcessingSource: {
            /** @constant */
            kind: "note";
            note_id: string;
            text_sha256: string;
        } | {
            /** @constant */
            kind: "media_version";
            evidence_id: string;
            version_id: string;
            sha256: string;
        };
        ProcessingSourceV3: ({
            /** @constant */
            kind: "note";
            note_id: string;
            text_sha256: string;
        } | {
            /** @constant */
            kind: "media_version";
            evidence_id: string;
            version_id: string;
            sha256: string;
        }) | {
            /** @constant */
            kind: "research_receipt";
            receipt_id: string;
            sha256: string;
        };
        ProcessingEnvelopeV1: {
            /** @constant */
            schema_version: "bench-intake-runner/1";
            job_id: string;
            attempt_id: string;
            command_id: string;
            input_sha256: string;
            /** @constant */
            profile_id: "synthetic-research/1";
            /** @constant */
            handler_version: "processing/1";
            /** Format: int64 */
            sequence: string;
            /** @constant */
            kind: "proposal";
            payload: {
                subject_id: string;
                summary: string;
                source_note_ids: string[];
            };
        } | {
            /** @constant */
            schema_version: "bench-intake-runner/1";
            job_id: string;
            attempt_id: string;
            command_id: string;
            input_sha256: string;
            /** @constant */
            profile_id: "synthetic-research/1";
            /** @constant */
            handler_version: "processing/1";
            /** Format: int64 */
            sequence: string;
            /** @constant */
            kind: "question";
            payload: {
                kind: "quantity" | "clarification";
                subject_id: string;
                prompt: string;
                reason: string;
            };
        } | {
            /** @constant */
            schema_version: "bench-intake-runner/1";
            job_id: string;
            attempt_id: string;
            command_id: string;
            input_sha256: string;
            /** @constant */
            profile_id: "synthetic-research/1";
            /** @constant */
            handler_version: "processing/1";
            /** Format: int64 */
            sequence: string;
            /** @constant */
            kind: "terminal";
            payload: {
                state: "ready" | "failed" | "waiting_for_login" | "waiting_for_capacity" | "interrupted";
            };
        };
        ProcessingEnvelopeV2: {
            /** @constant */
            schema_version: "bench-intake-runner/2";
            job_id: string;
            attempt_id: string;
            command_id: string;
            input_sha256: string;
            /** @constant */
            profile_id: "synthetic-research/2";
            /** @constant */
            handler_version: "processing/2";
            /** Format: int64 */
            sequence: string;
            /** @constant */
            kind: "proposal";
            payload: {
                /** @constant */
                schema_version: "bench-intake-proposal/2";
                subject_id: string;
                summary: string;
                sources: ({
                    /** @constant */
                    kind: "note";
                    note_id: string;
                    text_sha256: string;
                } | {
                    /** @constant */
                    kind: "media_version";
                    evidence_id: string;
                    version_id: string;
                    sha256: string;
                })[];
            };
        } | {
            /** @constant */
            schema_version: "bench-intake-runner/2";
            job_id: string;
            attempt_id: string;
            command_id: string;
            input_sha256: string;
            /** @constant */
            profile_id: "synthetic-research/2";
            /** @constant */
            handler_version: "processing/2";
            /** Format: int64 */
            sequence: string;
            /** @constant */
            kind: "question";
            payload: {
                kind: "quantity" | "clarification";
                subject_id: string;
                prompt: string;
                reason: string;
            };
        } | {
            /** @constant */
            schema_version: "bench-intake-runner/2";
            job_id: string;
            attempt_id: string;
            command_id: string;
            input_sha256: string;
            /** @constant */
            profile_id: "synthetic-research/2";
            /** @constant */
            handler_version: "processing/2";
            /** Format: int64 */
            sequence: string;
            /** @constant */
            kind: "terminal";
            payload: {
                state: "ready" | "failed" | "waiting_for_login" | "waiting_for_capacity" | "interrupted";
            };
        };
        ProcessingEnvelopeV3: {
            /** @constant */
            schema_version: "bench-intake-runner/3";
            job_id: string;
            attempt_id: string;
            command_id: string;
            input_sha256: string;
            /** @constant */
            profile_id: "restricted-research-stub/1";
            /** @constant */
            handler_version: "processing/3";
            /** Format: int64 */
            sequence: string;
            /** @constant */
            kind: "proposal";
            payload: {
                /** @constant */
                schema_version: "bench-intake-proposal/3";
                subject_id: string;
                summary: string;
                sources: (({
                    /** @constant */
                    kind: "note";
                    note_id: string;
                    text_sha256: string;
                } | {
                    /** @constant */
                    kind: "media_version";
                    evidence_id: string;
                    version_id: string;
                    sha256: string;
                }) | {
                    /** @constant */
                    kind: "research_receipt";
                    receipt_id: string;
                    sha256: string;
                })[];
            };
        } | {
            /** @constant */
            schema_version: "bench-intake-runner/3";
            job_id: string;
            attempt_id: string;
            command_id: string;
            input_sha256: string;
            /** @constant */
            profile_id: "restricted-research-stub/1";
            /** @constant */
            handler_version: "processing/3";
            /** Format: int64 */
            sequence: string;
            /** @constant */
            kind: "question";
            payload: {
                kind: "quantity" | "clarification";
                subject_id: string;
                prompt: string;
                reason: string;
            };
        } | {
            /** @constant */
            schema_version: "bench-intake-runner/3";
            job_id: string;
            attempt_id: string;
            command_id: string;
            input_sha256: string;
            /** @constant */
            profile_id: "restricted-research-stub/1";
            /** @constant */
            handler_version: "processing/3";
            /** Format: int64 */
            sequence: string;
            /** @constant */
            kind: "terminal";
            payload: {
                state: "ready" | "failed" | "waiting_for_login" | "waiting_for_capacity" | "interrupted";
            };
        };
        ProcessingBlocker: "media_not_ready" | "media_input_capacity" | "worker_version_conflict";
        ProcessingInput: {
            /** @constant */
            schema_version: "bench-intake-input/1";
            batch_id: string;
            source_id: string;
            /** Format: int64 */
            capture_revision: string;
            subject_id: string;
            stage: "reading" | "identifying" | "research" | "images" | "inventory";
            dependencies: string[];
            answer_id: string | null;
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
            subject: {
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
                /** @constant */
                retired?: true;
            } | {
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
                } | {
                    /** @constant */
                    mode: "create";
                    spec: {
                        name: string;
                        category: {
                            observation_id: string;
                            target_context_id: string;
                            /** @constant */
                            model: "category";
                            /** Format: int64 */
                            pk: string;
                        };
                        parameters: {
                            template: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "parameter_template";
                                /** Format: int64 */
                                pk: string;
                            };
                            category_mapping: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "category_parameter";
                                /** Format: int64 */
                                pk: string;
                            };
                            value: string;
                        }[];
                        manufacturer: null | {
                            company: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "company";
                                /** Format: int64 */
                                pk: string;
                            };
                            mpn: string;
                        };
                        supplier: null | {
                            company: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "company";
                                /** Format: int64 */
                                pk: string;
                            };
                            sku: string;
                        };
                        tags: string[];
                    };
                };
            };
            linked_part: {
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
                } | {
                    /** @constant */
                    mode: "create";
                    spec: {
                        name: string;
                        category: {
                            observation_id: string;
                            target_context_id: string;
                            /** @constant */
                            model: "category";
                            /** Format: int64 */
                            pk: string;
                        };
                        parameters: {
                            template: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "parameter_template";
                                /** Format: int64 */
                                pk: string;
                            };
                            category_mapping: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "category_parameter";
                                /** Format: int64 */
                                pk: string;
                            };
                            value: string;
                        }[];
                        manufacturer: null | {
                            company: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "company";
                                /** Format: int64 */
                                pk: string;
                            };
                            mpn: string;
                        };
                        supplier: null | {
                            company: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "company";
                                /** Format: int64 */
                                pk: string;
                            };
                            sku: string;
                        };
                        tags: string[];
                    };
                };
            } | null;
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
                model: "part" | "location" | "category" | "parameter_template" | "category_parameter" | "company";
                mapping?: {
                    /** @constant */
                    kind: "category";
                } | {
                    /** @constant */
                    kind: "parameter_template";
                    model_type: "part.part" | null;
                    enabled: boolean;
                } | {
                    /** @constant */
                    kind: "category_parameter";
                    /** Format: int64 */
                    category_id: string;
                    /** Format: int64 */
                    template_id: string;
                } | {
                    /** @constant */
                    kind: "company";
                    manufacturer: boolean;
                    supplier: boolean;
                };
                /** Format: int64 */
                pk: string;
                target_context_id: string;
                label: string;
                observed_at: string;
            }[];
            /** @constant */
            profile_id: "synthetic-research/1";
            /** @constant */
            instruction_version: "restricted-synthetic/1";
            instruction_sha256: string;
            /** @constant */
            tool_profile_version: "restricted-no-tools/1";
            media: string[];
        } | {
            /** @constant */
            schema_version: "bench-intake-input/2";
            batch_id: string;
            source_id: string;
            /** Format: int64 */
            capture_revision: string;
            subject_id: string;
            stage: "reading" | "identifying" | "research" | "images" | "inventory";
            dependencies: string[];
            answer_id: string | null;
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
            subject: {
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
                /** @constant */
                retired?: true;
            } | {
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
                } | {
                    /** @constant */
                    mode: "create";
                    spec: {
                        name: string;
                        category: {
                            observation_id: string;
                            target_context_id: string;
                            /** @constant */
                            model: "category";
                            /** Format: int64 */
                            pk: string;
                        };
                        parameters: {
                            template: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "parameter_template";
                                /** Format: int64 */
                                pk: string;
                            };
                            category_mapping: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "category_parameter";
                                /** Format: int64 */
                                pk: string;
                            };
                            value: string;
                        }[];
                        manufacturer: null | {
                            company: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "company";
                                /** Format: int64 */
                                pk: string;
                            };
                            mpn: string;
                        };
                        supplier: null | {
                            company: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "company";
                                /** Format: int64 */
                                pk: string;
                            };
                            sku: string;
                        };
                        tags: string[];
                    };
                };
            };
            linked_part: {
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
                } | {
                    /** @constant */
                    mode: "create";
                    spec: {
                        name: string;
                        category: {
                            observation_id: string;
                            target_context_id: string;
                            /** @constant */
                            model: "category";
                            /** Format: int64 */
                            pk: string;
                        };
                        parameters: {
                            template: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "parameter_template";
                                /** Format: int64 */
                                pk: string;
                            };
                            category_mapping: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "category_parameter";
                                /** Format: int64 */
                                pk: string;
                            };
                            value: string;
                        }[];
                        manufacturer: null | {
                            company: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "company";
                                /** Format: int64 */
                                pk: string;
                            };
                            mpn: string;
                        };
                        supplier: null | {
                            company: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "company";
                                /** Format: int64 */
                                pk: string;
                            };
                            sku: string;
                        };
                        tags: string[];
                    };
                };
            } | null;
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
                model: "part" | "location" | "category" | "parameter_template" | "category_parameter" | "company";
                mapping?: {
                    /** @constant */
                    kind: "category";
                } | {
                    /** @constant */
                    kind: "parameter_template";
                    model_type: "part.part" | null;
                    enabled: boolean;
                } | {
                    /** @constant */
                    kind: "category_parameter";
                    /** Format: int64 */
                    category_id: string;
                    /** Format: int64 */
                    template_id: string;
                } | {
                    /** @constant */
                    kind: "company";
                    manufacturer: boolean;
                    supplier: boolean;
                };
                /** Format: int64 */
                pk: string;
                target_context_id: string;
                label: string;
                observed_at: string;
            }[];
            /** @constant */
            profile_id: "synthetic-research/2";
            /** @constant */
            instruction_version: "restricted-synthetic/2";
            instruction_sha256: string;
            /** @constant */
            tool_profile_version: "restricted-no-tools/1";
            media: {
                manifest: string;
                sha256: string;
            };
        } | {
            /** @constant */
            schema_version: "bench-intake-input/3";
            batch_id: string;
            source_id: string;
            /** Format: int64 */
            capture_revision: string;
            subject_id: string;
            stage: "reading" | "identifying" | "research" | "images" | "inventory";
            dependencies: string[];
            answer_id: string | null;
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
            subject: {
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
                /** @constant */
                retired?: true;
            } | {
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
                } | {
                    /** @constant */
                    mode: "create";
                    spec: {
                        name: string;
                        category: {
                            observation_id: string;
                            target_context_id: string;
                            /** @constant */
                            model: "category";
                            /** Format: int64 */
                            pk: string;
                        };
                        parameters: {
                            template: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "parameter_template";
                                /** Format: int64 */
                                pk: string;
                            };
                            category_mapping: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "category_parameter";
                                /** Format: int64 */
                                pk: string;
                            };
                            value: string;
                        }[];
                        manufacturer: null | {
                            company: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "company";
                                /** Format: int64 */
                                pk: string;
                            };
                            mpn: string;
                        };
                        supplier: null | {
                            company: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "company";
                                /** Format: int64 */
                                pk: string;
                            };
                            sku: string;
                        };
                        tags: string[];
                    };
                };
            };
            linked_part: {
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
                } | {
                    /** @constant */
                    mode: "create";
                    spec: {
                        name: string;
                        category: {
                            observation_id: string;
                            target_context_id: string;
                            /** @constant */
                            model: "category";
                            /** Format: int64 */
                            pk: string;
                        };
                        parameters: {
                            template: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "parameter_template";
                                /** Format: int64 */
                                pk: string;
                            };
                            category_mapping: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "category_parameter";
                                /** Format: int64 */
                                pk: string;
                            };
                            value: string;
                        }[];
                        manufacturer: null | {
                            company: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "company";
                                /** Format: int64 */
                                pk: string;
                            };
                            mpn: string;
                        };
                        supplier: null | {
                            company: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "company";
                                /** Format: int64 */
                                pk: string;
                            };
                            sku: string;
                        };
                        tags: string[];
                    };
                };
            } | null;
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
                model: "part" | "location" | "category" | "parameter_template" | "category_parameter" | "company";
                mapping?: {
                    /** @constant */
                    kind: "category";
                } | {
                    /** @constant */
                    kind: "parameter_template";
                    model_type: "part.part" | null;
                    enabled: boolean;
                } | {
                    /** @constant */
                    kind: "category_parameter";
                    /** Format: int64 */
                    category_id: string;
                    /** Format: int64 */
                    template_id: string;
                } | {
                    /** @constant */
                    kind: "company";
                    manufacturer: boolean;
                    supplier: boolean;
                };
                /** Format: int64 */
                pk: string;
                target_context_id: string;
                label: string;
                observed_at: string;
            }[];
            /** @constant */
            profile_id: "restricted-research-stub/1";
            /** @constant */
            instruction_version: "restricted-research-stub/1";
            instruction_sha256: string;
            /** @constant */
            tool_profile_version: "restricted-research-tools/1";
            media: {
                manifest: string;
                sha256: string;
            };
            source_urls: string[];
        } | {
            /** @constant */
            schema_version: "bench-intake-input/4";
            batch_id: string;
            source_id: string;
            /** Format: int64 */
            capture_revision: string;
            subject_id: string;
            stage: "reading" | "identifying" | "research" | "images" | "inventory";
            dependencies: string[];
            answer_id: string | null;
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
            subject: {
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
                /** @constant */
                retired?: true;
            } | {
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
                } | {
                    /** @constant */
                    mode: "create";
                    spec: {
                        name: string;
                        category: {
                            observation_id: string;
                            target_context_id: string;
                            /** @constant */
                            model: "category";
                            /** Format: int64 */
                            pk: string;
                        };
                        parameters: {
                            template: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "parameter_template";
                                /** Format: int64 */
                                pk: string;
                            };
                            category_mapping: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "category_parameter";
                                /** Format: int64 */
                                pk: string;
                            };
                            value: string;
                        }[];
                        manufacturer: null | {
                            company: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "company";
                                /** Format: int64 */
                                pk: string;
                            };
                            mpn: string;
                        };
                        supplier: null | {
                            company: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "company";
                                /** Format: int64 */
                                pk: string;
                            };
                            sku: string;
                        };
                        tags: string[];
                    };
                };
            };
            linked_part: {
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
                } | {
                    /** @constant */
                    mode: "create";
                    spec: {
                        name: string;
                        category: {
                            observation_id: string;
                            target_context_id: string;
                            /** @constant */
                            model: "category";
                            /** Format: int64 */
                            pk: string;
                        };
                        parameters: {
                            template: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "parameter_template";
                                /** Format: int64 */
                                pk: string;
                            };
                            category_mapping: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "category_parameter";
                                /** Format: int64 */
                                pk: string;
                            };
                            value: string;
                        }[];
                        manufacturer: null | {
                            company: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "company";
                                /** Format: int64 */
                                pk: string;
                            };
                            mpn: string;
                        };
                        supplier: null | {
                            company: {
                                observation_id: string;
                                target_context_id: string;
                                /** @constant */
                                model: "company";
                                /** Format: int64 */
                                pk: string;
                            };
                            sku: string;
                        };
                        tags: string[];
                    };
                };
            } | null;
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
                model: "part" | "location" | "category" | "parameter_template" | "category_parameter" | "company";
                mapping?: {
                    /** @constant */
                    kind: "category";
                } | {
                    /** @constant */
                    kind: "parameter_template";
                    model_type: "part.part" | null;
                    enabled: boolean;
                } | {
                    /** @constant */
                    kind: "category_parameter";
                    /** Format: int64 */
                    category_id: string;
                    /** Format: int64 */
                    template_id: string;
                } | {
                    /** @constant */
                    kind: "company";
                    manufacturer: boolean;
                    supplier: boolean;
                };
                /** Format: int64 */
                pk: string;
                target_context_id: string;
                label: string;
                observed_at: string;
            }[];
            /** @constant */
            profile_id: "native-agent/1";
            /** @constant */
            instruction_version: "native-agent/1";
            instruction_sha256: string;
            /** @constant */
            tool_profile_version: "native-no-tools/1";
            media: {
                manifest: string;
                sha256: string;
            };
            agent: {
                provider: "codex" | "claude";
                authentication: "api_key" | "subscription";
                model: string;
            };
            /** Format: int64 */
            settings_revision: string;
        };
        ProcessingCommand: {
            /** @constant */
            schema_version: "bench-intake-processing-command/4";
            job_id: string;
            attempt_id: string;
            input_id: string;
            input_sha256: string;
            /** @constant */
            profile_id: "native-agent/1";
            /** @constant */
            handler_version: "processing/4";
            command_id: string;
        } | {
            /** @constant */
            schema_version: "bench-intake-processing-command/1";
            job_id: string;
            attempt_id: string;
            input_id: string;
            input_sha256: string;
            /** @constant */
            profile_id: "synthetic-research/1";
            /** @constant */
            handler_version: "processing/1";
            command_id: string;
        } | {
            /** @constant */
            schema_version: "bench-intake-processing-command/2";
            job_id: string;
            attempt_id: string;
            input_id: string;
            input_sha256: string;
            /** @constant */
            profile_id: "synthetic-research/2";
            /** @constant */
            handler_version: "processing/2";
            command_id: string;
        } | {
            /** @constant */
            schema_version: "bench-intake-processing-command/3";
            job_id: string;
            attempt_id: string;
            input_id: string;
            input_sha256: string;
            /** @constant */
            profile_id: "restricted-research-stub/1";
            /** @constant */
            handler_version: "processing/3";
            command_id: string;
        };
        ProcessingActivity: {
            jobs: {
                batch_id: string;
                job_id: string;
                attempt_id: string;
                state: "queued" | "running" | "waiting_for_user" | "waiting_for_login" | "waiting_for_capacity" | "ready" | "failed" | "cancelled" | "superseded" | "interrupted";
                input_current: boolean;
                occupies_lane: boolean;
                blocked_code?: "media_not_ready" | "media_input_capacity" | "worker_version_conflict";
            }[];
            lane_occupied: boolean;
            truncated: boolean;
        };
        ProcessingStage: "reading" | "identifying" | "research" | "images" | "inventory";
        ProcessingState: "queued" | "running" | "waiting_for_user" | "waiting_for_login" | "waiting_for_capacity" | "ready" | "failed" | "cancelled" | "superseded" | "interrupted";
        ProcessingStart: {
            /** @constant */
            schema_version: "bench-intake-processing/1";
            /** Format: int64 */
            expected_capture_revision: string;
            subject_ids: string[];
            stages: ("reading" | "identifying" | "research" | "images" | "inventory")[];
        };
        ProcessingCancellation: {
            /** Format: int64 */
            expected_revision: string;
            attempt_id: string;
        };
        ProcessingQuestionValue: {
            /** @constant */
            kind: "quantity";
            value: string;
            basis: "counted" | "estimated";
        } | {
            /** @constant */
            kind: "clarification";
            text: string;
        };
        ProcessingAnswer: {
            /** @constant */
            schema_version: "bench-intake-answer/1";
            /** Format: int64 */
            expected_question_revision: string;
            /** Format: int64 */
            expected_capture_revision: string;
            attempt_id: string;
            input_sha256: string;
            value: {
                /** @constant */
                kind: "quantity";
                value: string;
                basis: "counted" | "estimated";
            } | {
                /** @constant */
                kind: "clarification";
                text: string;
            };
        };
        ProcessingQuestionSpec: {
            kind: "quantity" | "clarification";
            subject_id: string;
            prompt: string;
            reason: string;
        };
        ProcessingProposal: {
            subject_id: string;
            summary: string;
            source_note_ids: string[];
        } | {
            /** @constant */
            schema_version: "bench-intake-proposal/2";
            subject_id: string;
            summary: string;
            sources: ({
                /** @constant */
                kind: "note";
                note_id: string;
                text_sha256: string;
            } | {
                /** @constant */
                kind: "media_version";
                evidence_id: string;
                version_id: string;
                sha256: string;
            })[];
        } | {
            /** @constant */
            schema_version: "bench-intake-proposal/3";
            subject_id: string;
            summary: string;
            sources: (({
                /** @constant */
                kind: "note";
                note_id: string;
                text_sha256: string;
            } | {
                /** @constant */
                kind: "media_version";
                evidence_id: string;
                version_id: string;
                sha256: string;
            }) | {
                /** @constant */
                kind: "research_receipt";
                receipt_id: string;
                sha256: string;
            })[];
        };
        ProcessingEnvelope: ({
            /** @constant */
            schema_version: "bench-intake-runner/4";
            job_id: string;
            attempt_id: string;
            command_id: string;
            input_sha256: string;
            /** @constant */
            profile_id: "native-agent/1";
            /** @constant */
            handler_version: "processing/4";
            /** Format: int64 */
            sequence: string;
            /** @constant */
            kind: "proposal";
            payload: {
                /** @constant */
                schema_version: "bench-intake-proposal/2";
                subject_id: string;
                summary: string;
                sources: ({
                    /** @constant */
                    kind: "note";
                    note_id: string;
                    text_sha256: string;
                } | {
                    /** @constant */
                    kind: "media_version";
                    evidence_id: string;
                    version_id: string;
                    sha256: string;
                })[];
            };
        } | {
            /** @constant */
            schema_version: "bench-intake-runner/4";
            job_id: string;
            attempt_id: string;
            command_id: string;
            input_sha256: string;
            /** @constant */
            profile_id: "native-agent/1";
            /** @constant */
            handler_version: "processing/4";
            /** Format: int64 */
            sequence: string;
            /** @constant */
            kind: "question";
            payload: {
                kind: "quantity" | "clarification";
                subject_id: string;
                prompt: string;
                reason: string;
            };
        } | {
            /** @constant */
            schema_version: "bench-intake-runner/4";
            job_id: string;
            attempt_id: string;
            command_id: string;
            input_sha256: string;
            /** @constant */
            profile_id: "native-agent/1";
            /** @constant */
            handler_version: "processing/4";
            /** Format: int64 */
            sequence: string;
            /** @constant */
            kind: "terminal";
            payload: {
                state: "ready" | "failed" | "waiting_for_login" | "waiting_for_capacity" | "interrupted";
            };
        }) | ({
            /** @constant */
            schema_version: "bench-intake-runner/1";
            job_id: string;
            attempt_id: string;
            command_id: string;
            input_sha256: string;
            /** @constant */
            profile_id: "synthetic-research/1";
            /** @constant */
            handler_version: "processing/1";
            /** Format: int64 */
            sequence: string;
            /** @constant */
            kind: "proposal";
            payload: {
                subject_id: string;
                summary: string;
                source_note_ids: string[];
            };
        } | {
            /** @constant */
            schema_version: "bench-intake-runner/1";
            job_id: string;
            attempt_id: string;
            command_id: string;
            input_sha256: string;
            /** @constant */
            profile_id: "synthetic-research/1";
            /** @constant */
            handler_version: "processing/1";
            /** Format: int64 */
            sequence: string;
            /** @constant */
            kind: "question";
            payload: {
                kind: "quantity" | "clarification";
                subject_id: string;
                prompt: string;
                reason: string;
            };
        } | {
            /** @constant */
            schema_version: "bench-intake-runner/1";
            job_id: string;
            attempt_id: string;
            command_id: string;
            input_sha256: string;
            /** @constant */
            profile_id: "synthetic-research/1";
            /** @constant */
            handler_version: "processing/1";
            /** Format: int64 */
            sequence: string;
            /** @constant */
            kind: "terminal";
            payload: {
                state: "ready" | "failed" | "waiting_for_login" | "waiting_for_capacity" | "interrupted";
            };
        }) | ({
            /** @constant */
            schema_version: "bench-intake-runner/2";
            job_id: string;
            attempt_id: string;
            command_id: string;
            input_sha256: string;
            /** @constant */
            profile_id: "synthetic-research/2";
            /** @constant */
            handler_version: "processing/2";
            /** Format: int64 */
            sequence: string;
            /** @constant */
            kind: "proposal";
            payload: {
                /** @constant */
                schema_version: "bench-intake-proposal/2";
                subject_id: string;
                summary: string;
                sources: ({
                    /** @constant */
                    kind: "note";
                    note_id: string;
                    text_sha256: string;
                } | {
                    /** @constant */
                    kind: "media_version";
                    evidence_id: string;
                    version_id: string;
                    sha256: string;
                })[];
            };
        } | {
            /** @constant */
            schema_version: "bench-intake-runner/2";
            job_id: string;
            attempt_id: string;
            command_id: string;
            input_sha256: string;
            /** @constant */
            profile_id: "synthetic-research/2";
            /** @constant */
            handler_version: "processing/2";
            /** Format: int64 */
            sequence: string;
            /** @constant */
            kind: "question";
            payload: {
                kind: "quantity" | "clarification";
                subject_id: string;
                prompt: string;
                reason: string;
            };
        } | {
            /** @constant */
            schema_version: "bench-intake-runner/2";
            job_id: string;
            attempt_id: string;
            command_id: string;
            input_sha256: string;
            /** @constant */
            profile_id: "synthetic-research/2";
            /** @constant */
            handler_version: "processing/2";
            /** Format: int64 */
            sequence: string;
            /** @constant */
            kind: "terminal";
            payload: {
                state: "ready" | "failed" | "waiting_for_login" | "waiting_for_capacity" | "interrupted";
            };
        }) | ({
            /** @constant */
            schema_version: "bench-intake-runner/3";
            job_id: string;
            attempt_id: string;
            command_id: string;
            input_sha256: string;
            /** @constant */
            profile_id: "restricted-research-stub/1";
            /** @constant */
            handler_version: "processing/3";
            /** Format: int64 */
            sequence: string;
            /** @constant */
            kind: "proposal";
            payload: {
                /** @constant */
                schema_version: "bench-intake-proposal/3";
                subject_id: string;
                summary: string;
                sources: (({
                    /** @constant */
                    kind: "note";
                    note_id: string;
                    text_sha256: string;
                } | {
                    /** @constant */
                    kind: "media_version";
                    evidence_id: string;
                    version_id: string;
                    sha256: string;
                }) | {
                    /** @constant */
                    kind: "research_receipt";
                    receipt_id: string;
                    sha256: string;
                })[];
            };
        } | {
            /** @constant */
            schema_version: "bench-intake-runner/3";
            job_id: string;
            attempt_id: string;
            command_id: string;
            input_sha256: string;
            /** @constant */
            profile_id: "restricted-research-stub/1";
            /** @constant */
            handler_version: "processing/3";
            /** Format: int64 */
            sequence: string;
            /** @constant */
            kind: "question";
            payload: {
                kind: "quantity" | "clarification";
                subject_id: string;
                prompt: string;
                reason: string;
            };
        } | {
            /** @constant */
            schema_version: "bench-intake-runner/3";
            job_id: string;
            attempt_id: string;
            command_id: string;
            input_sha256: string;
            /** @constant */
            profile_id: "restricted-research-stub/1";
            /** @constant */
            handler_version: "processing/3";
            /** Format: int64 */
            sequence: string;
            /** @constant */
            kind: "terminal";
            payload: {
                state: "ready" | "failed" | "waiting_for_login" | "waiting_for_capacity" | "interrupted";
            };
        });
        ProcessingQuestion: {
            id: string;
            job_id: string;
            attempt_id: string;
            input_sha256: string;
            /** Format: int64 */
            revision: string;
            state: "open" | "answered" | "superseded";
            spec: {
                kind: "quantity" | "clarification";
                subject_id: string;
                prompt: string;
                reason: string;
            };
        };
        ProcessingJob: {
            id: string;
            subject_id: string;
            stage: "reading" | "identifying" | "research" | "images" | "inventory";
            /** Format: int64 */
            revision: string;
            state: "queued" | "running" | "waiting_for_user" | "waiting_for_login" | "waiting_for_capacity" | "ready" | "failed" | "cancelled" | "superseded" | "interrupted";
            attempt_id: string;
            input_sha256: string;
            /** Format: int64 */
            attempt_number: string;
            qualification: "fixture_only" | "native_unverified";
            can_cancel?: boolean;
            blocked_code?: "media_not_ready" | "media_input_capacity" | "worker_version_conflict";
            proposals: {
                id: string;
                message_id: string;
                value: {
                    subject_id: string;
                    summary: string;
                    source_note_ids: string[];
                } | {
                    /** @constant */
                    schema_version: "bench-intake-proposal/2";
                    subject_id: string;
                    summary: string;
                    sources: ({
                        /** @constant */
                        kind: "note";
                        note_id: string;
                        text_sha256: string;
                    } | {
                        /** @constant */
                        kind: "media_version";
                        evidence_id: string;
                        version_id: string;
                        sha256: string;
                    })[];
                } | {
                    /** @constant */
                    schema_version: "bench-intake-proposal/3";
                    subject_id: string;
                    summary: string;
                    sources: (({
                        /** @constant */
                        kind: "note";
                        note_id: string;
                        text_sha256: string;
                    } | {
                        /** @constant */
                        kind: "media_version";
                        evidence_id: string;
                        version_id: string;
                        sha256: string;
                    }) | {
                        /** @constant */
                        kind: "research_receipt";
                        receipt_id: string;
                        sha256: string;
                    })[];
                };
            }[];
            questions: {
                id: string;
                job_id: string;
                attempt_id: string;
                input_sha256: string;
                /** Format: int64 */
                revision: string;
                state: "open" | "answered" | "superseded";
                spec: {
                    kind: "quantity" | "clarification";
                    subject_id: string;
                    prompt: string;
                    reason: string;
                };
            }[];
        };
        ProcessingSnapshot: {
            runner_status: "unconfigured" | "fixture_only" | "native_unverified";
            batch_id: string;
            /** Format: int64 */
            capture_revision: string;
            jobs: {
                id: string;
                subject_id: string;
                stage: "reading" | "identifying" | "research" | "images" | "inventory";
                /** Format: int64 */
                revision: string;
                state: "queued" | "running" | "waiting_for_user" | "waiting_for_login" | "waiting_for_capacity" | "ready" | "failed" | "cancelled" | "superseded" | "interrupted";
                attempt_id: string;
                input_sha256: string;
                /** Format: int64 */
                attempt_number: string;
                qualification: "fixture_only" | "native_unverified";
                can_cancel?: boolean;
                blocked_code?: "media_not_ready" | "media_input_capacity" | "worker_version_conflict";
                proposals: {
                    id: string;
                    message_id: string;
                    value: {
                        subject_id: string;
                        summary: string;
                        source_note_ids: string[];
                    } | {
                        /** @constant */
                        schema_version: "bench-intake-proposal/2";
                        subject_id: string;
                        summary: string;
                        sources: ({
                            /** @constant */
                            kind: "note";
                            note_id: string;
                            text_sha256: string;
                        } | {
                            /** @constant */
                            kind: "media_version";
                            evidence_id: string;
                            version_id: string;
                            sha256: string;
                        })[];
                    } | {
                        /** @constant */
                        schema_version: "bench-intake-proposal/3";
                        subject_id: string;
                        summary: string;
                        sources: (({
                            /** @constant */
                            kind: "note";
                            note_id: string;
                            text_sha256: string;
                        } | {
                            /** @constant */
                            kind: "media_version";
                            evidence_id: string;
                            version_id: string;
                            sha256: string;
                        }) | {
                            /** @constant */
                            kind: "research_receipt";
                            receipt_id: string;
                            sha256: string;
                        })[];
                    };
                }[];
                questions: {
                    id: string;
                    job_id: string;
                    attempt_id: string;
                    input_sha256: string;
                    /** Format: int64 */
                    revision: string;
                    state: "open" | "answered" | "superseded";
                    spec: {
                        kind: "quantity" | "clarification";
                        subject_id: string;
                        prompt: string;
                        reason: string;
                    };
                }[];
            }[];
            cursor: {
                stream_id: string;
                /** Format: int64 */
                sequence: string;
            };
        };
        ProcessingReceipt: {
            batch_id: string;
            job_ids: string[];
            attempt_ids: string[];
        };
        ProcessingAnswerReceipt: {
            answer_id: string;
            question_id: string;
            attempt_id: string;
            /** Format: int64 */
            capture_revision: string;
            command_id: string;
        };
        OperatorIssueSeverity: "blocking" | "warning";
        OperatorIssueDisposition: {
            id: string;
            reason: string;
            actor_id: string;
            created_at: string;
        };
        OperatorIssue: {
            code: string;
            severity: "blocking" | "warning";
            message: string;
            subject_id: string | null;
            lot_id: string | null;
            run_id: string | null;
            dependency_digest: string | null;
            disposition: {
                id: string;
                reason: string;
                actor_id: string;
                created_at: string;
            } | null;
        };
        OperatorReviewState: "unreviewed" | "reviewed" | "changed_after_review";
        OperatorLot: {
            lot_id: string;
            label: string;
            part_subject_id: string | null;
            shared_lot_ids: string[];
            review_state: "unreviewed" | "reviewed" | "changed_after_review";
            approved: boolean;
            issues: {
                code: string;
                severity: "blocking" | "warning";
                message: string;
                subject_id: string | null;
                lot_id: string | null;
                run_id: string | null;
                dependency_digest: string | null;
                disposition: {
                    id: string;
                    reason: string;
                    actor_id: string;
                    created_at: string;
                } | null;
            }[];
            predecessor_lot_ids: string[];
        };
        OperatorRetiredLot: {
            lot_id: string;
            label: string;
            action: "split" | "merge";
            /** Format: int64 */
            retired_revision: string;
            successor_lot_ids: string[];
        };
        OperatorInstruction: {
            group_id: string | null;
            /** Format: int64 */
            version: string;
            text: string;
            actor_id: string;
            created_at: string;
        };
        OperatorReview: {
            batch_id: string;
            /** Format: int64 */
            revision: string;
            lots: {
                lot_id: string;
                label: string;
                part_subject_id: string | null;
                shared_lot_ids: string[];
                review_state: "unreviewed" | "reviewed" | "changed_after_review";
                approved: boolean;
                issues: {
                    code: string;
                    severity: "blocking" | "warning";
                    message: string;
                    subject_id: string | null;
                    lot_id: string | null;
                    run_id: string | null;
                    dependency_digest: string | null;
                    disposition: {
                        id: string;
                        reason: string;
                        actor_id: string;
                        created_at: string;
                    } | null;
                }[];
                predecessor_lot_ids: string[];
            }[];
            retired_lots: {
                lot_id: string;
                label: string;
                action: "split" | "merge";
                /** Format: int64 */
                retired_revision: string;
                successor_lot_ids: string[];
            }[];
            instructions: {
                group_id: string | null;
                /** Format: int64 */
                version: string;
                text: string;
                actor_id: string;
                created_at: string;
            }[];
            cursor: {
                stream_id: string;
                /** Format: int64 */
                sequence: string;
            };
        };
        IssueDisposition: {
            /** Format: int64 */
            expected_batch_revision: string;
            subject_id: string;
            code: string;
            dependency_digest: string;
            reason: string;
        };
        BulkEdit: {
            /** Format: int64 */
            expected_revision: string;
            preview: boolean;
            lot_ids: string[];
            change: {
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
            };
        };
        OperatorImpact: {
            invalidated_review_subject_ids: string[];
            affected_lot_ids: string[];
            affected_part_ids: string[];
            stale_preparation_ids: string[];
            retired_lot_ids: string[];
            created_lots: {
                lot_id: string | null;
                label: string;
            }[];
            created_part: {
                part_id: string | null;
                label: string;
            } | null;
        };
        BulkEditResult: {
            status: "previewed" | "applied";
            /** Format: int64 */
            revision: string;
            impact: {
                invalidated_review_subject_ids: string[];
                affected_lot_ids: string[];
                affected_part_ids: string[];
                stale_preparation_ids: string[];
                retired_lot_ids: string[];
                created_lots: {
                    lot_id: string | null;
                    label: string;
                }[];
                created_part: {
                    part_id: string | null;
                    label: string;
                } | null;
            };
        };
        Restructure: {
            /** Format: int64 */
            expected_revision: string;
            preview: boolean;
            change: {
                /** @constant */
                kind: "split_lot";
                lot_id: string;
                children: {
                    label: string;
                    quantity: string;
                }[];
            } | {
                /** @constant */
                kind: "merge_lots";
                lot_ids: string[];
                label: string;
                quantity: string;
                part_subject_id: string | null;
                /** @constant */
                confirm_same_physical_contribution: true;
            } | {
                /** @constant */
                kind: "move_lots";
                lot_ids: string[];
                destination: {
                    /** @constant */
                    kind: "existing";
                    part_subject_id: string;
                } | {
                    /** @constant */
                    kind: "new";
                    label: string;
                } | {
                    /** @constant */
                    kind: "none";
                };
            };
        };
        RestructureResult: {
            status: "previewed" | "applied";
            /** Format: int64 */
            revision: string;
            impact: {
                invalidated_review_subject_ids: string[];
                affected_lot_ids: string[];
                affected_part_ids: string[];
                stale_preparation_ids: string[];
                retired_lot_ids: string[];
                created_lots: {
                    lot_id: string | null;
                    label: string;
                }[];
                created_part: {
                    part_id: string | null;
                    label: string;
                } | null;
            };
        };
        InstructionEdit: {
            /** Format: int64 */
            expected_revision: string;
            group_id: string | null;
            text: string;
        };
        ResearchReceiptSource: {
            /** @constant */
            kind: "research_receipt";
            receipt_id: string;
            sha256: string;
        };
        ResearchEvidenceRead: {
            version_id: string;
            sha256: string;
            /** Format: int64 */
            offset: string;
            length: string;
        };
        ResearchSourceFetch: {
            url: string;
        };
        ResearchReceiptRead: {
            receipt_id: string;
            sha256: string;
            /** Format: int64 */
            offset: string;
            length: string;
        };
        ResearchInventoryLookup: {
            model: "part" | "location";
            /** Format: int64 */
            pk: string;
        };
        ResearchReceipt: {
            id: string;
            kind: "web" | "inventory";
            sha256: string;
            /** Format: int64 */
            byte_size: string;
            media_type: "image/png" | "image/jpeg" | "application/pdf" | "text/html" | "text/plain" | "application/json";
            source_url?: string;
        };
        ResearchReceiptDescriptor: {
            /** @constant */
            schema_version: "bench-intake-research-receipt/1";
            batch_id: string;
            attempt_id: string;
            command_id: string;
            actor_id: string;
            target_id: string;
            target_context_id: string;
            input_sha256: string;
            request_id: string;
            request_sha256: string;
            receipt: {
                id: string;
                kind: "web" | "inventory";
                sha256: string;
                /** Format: int64 */
                byte_size: string;
                media_type: "image/png" | "image/jpeg" | "application/pdf" | "text/html" | "text/plain" | "application/json";
                source_url?: string;
            };
        };
        ResearchEvidenceChunk: {
            evidence_id: string;
            version_id: string;
            sha256: string;
            /** Format: int64 */
            byte_size: string;
            media_type: "image/png" | "image/jpeg" | "application/pdf" | "text/html" | "text/plain" | "application/json";
            /** Format: int64 */
            offset: string;
            bytes_base64: string;
        };
        ResearchSourceChunk: {
            receipt: {
                id: string;
                kind: "web" | "inventory";
                sha256: string;
                /** Format: int64 */
                byte_size: string;
                media_type: "image/png" | "image/jpeg" | "application/pdf" | "text/html" | "text/plain" | "application/json";
                source_url?: string;
            };
            /** Format: int64 */
            offset: string;
            bytes_base64: string;
        };
        ResearchInventoryObservation: {
            model: "part" | "location";
            /** Format: int64 */
            pk: string;
            label: string;
        };
        ResearchInventoryResult: {
            receipt: {
                id: string;
                kind: "web" | "inventory";
                sha256: string;
                /** Format: int64 */
                byte_size: string;
                media_type: "image/png" | "image/jpeg" | "application/pdf" | "text/html" | "text/plain" | "application/json";
                source_url?: string;
            };
            observation: {
                model: "part" | "location";
                /** Format: int64 */
                pk: string;
                label: string;
            };
        };
        MediaRecipe: {
            /** @constant */
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
        } | {
            /** @constant */
            version: "documentary-rotated-region/1";
            source_version_id: string;
            source_digest: string;
            page: number;
            source_width: number;
            source_height: number;
            center_x_micro: string;
            center_y_micro: string;
            width_micro: string;
            height_micro: string;
            rotation_millidegrees: number;
            output_width: number;
            output_height: number;
            aspect_ratio: {
                width: number;
                height: number;
            } | null;
        };
        MediaVersion: {
            id: string;
            evidence_id: string;
            kind: "original" | "derived";
            digest: string;
            byte_size: string;
            media_type: "image/jpeg" | "image/png" | "application/pdf" | "application/octet-stream";
            state: "queued" | "ready" | "unsupported" | "encrypted" | "malformed" | "limit_exceeded" | "interrupted";
            decoder_build: string | null;
            recipe: ({
                /** @constant */
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
            } | {
                /** @constant */
                version: "documentary-rotated-region/1";
                source_version_id: string;
                source_digest: string;
                page: number;
                source_width: number;
                source_height: number;
                center_x_micro: string;
                center_y_micro: string;
                width_micro: string;
                height_micro: string;
                rotation_millidegrees: number;
                output_width: number;
                output_height: number;
                aspect_ratio: {
                    width: number;
                    height: number;
                } | null;
            }) | null;
            pages: {
                page: number;
                width: number;
                height: number;
                preview_id: string;
            }[];
        };
        MediaSnapshot: {
            batch_id: string;
            /** Format: int64 */
            revision: string;
            evidence: {
                id: string;
                label: string;
                group_id: string | null;
                linked_subject_ids: string[];
                note?: {
                    id: string;
                    /** Format: int64 */
                    version: string;
                    text: string;
                    actor_id: string;
                    created_at: string;
                };
                versions: {
                    id: string;
                    evidence_id: string;
                    kind: "original" | "derived";
                    digest: string;
                    byte_size: string;
                    media_type: "image/jpeg" | "image/png" | "application/pdf" | "application/octet-stream";
                    state: "queued" | "ready" | "unsupported" | "encrypted" | "malformed" | "limit_exceeded" | "interrupted";
                    decoder_build: string | null;
                    recipe: ({
                        /** @constant */
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
                    } | {
                        /** @constant */
                        version: "documentary-rotated-region/1";
                        source_version_id: string;
                        source_digest: string;
                        page: number;
                        source_width: number;
                        source_height: number;
                        center_x_micro: string;
                        center_y_micro: string;
                        width_micro: string;
                        height_micro: string;
                        rotation_millidegrees: number;
                        output_width: number;
                        output_height: number;
                        aspect_ratio: {
                            width: number;
                            height: number;
                        } | null;
                    }) | null;
                    pages: {
                        page: number;
                        width: number;
                        height: number;
                        preview_id: string;
                    }[];
                }[];
            }[];
            attachments: {
                id: string;
                subject_id: string;
                mode: "selected" | "declined" | "unset";
                version_id: string | null;
                destination: "lot_attachment" | "part_attachment";
            }[];
            groups: {
                id: string;
                label: string;
                note?: {
                    id: string;
                    /** Format: int64 */
                    version: string;
                    text: string;
                    actor_id: string;
                    created_at: string;
                };
            }[];
            derivations: {
                id: string;
                evidence_id: string;
                recipe: {
                    /** @constant */
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
                } | {
                    /** @constant */
                    version: "documentary-rotated-region/1";
                    source_version_id: string;
                    source_digest: string;
                    page: number;
                    source_width: number;
                    source_height: number;
                    center_x_micro: string;
                    center_y_micro: string;
                    width_micro: string;
                    height_micro: string;
                    rotation_millidegrees: number;
                    output_width: number;
                    output_height: number;
                    aspect_ratio: {
                        width: number;
                        height: number;
                    } | null;
                };
                state: "queued" | "ready" | "unsupported" | "encrypted" | "malformed" | "limit_exceeded" | "interrupted";
                version_id: string | null;
            }[];
        };
        MediaReceipt: {
            /** @constant */
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
                recipe: ({
                    /** @constant */
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
                } | {
                    /** @constant */
                    version: "documentary-rotated-region/1";
                    source_version_id: string;
                    source_digest: string;
                    page: number;
                    source_width: number;
                    source_height: number;
                    center_x_micro: string;
                    center_y_micro: string;
                    width_micro: string;
                    height_micro: string;
                    rotation_millidegrees: number;
                    output_width: number;
                    output_height: number;
                    aspect_ratio: {
                        width: number;
                        height: number;
                    } | null;
                }) | null;
                pages: {
                    page: number;
                    width: number;
                    height: number;
                    preview_id: string;
                }[];
            };
        };
        MediaEdit: {
            /** Format: int64 */
            expected_revision: string;
            change: {
                /** @constant */
                kind: "group";
                label: string;
            } | {
                /** @constant */
                kind: "rename_group";
                group_id: string;
                label: string;
            } | {
                /** @constant */
                kind: "ungroup";
                group_id: string;
            } | {
                /** @constant */
                kind: "move_many";
                evidence_ids: string[];
                group_id: string | null;
            } | {
                /** @constant */
                kind: "evidence_note";
                evidence_id: string;
                text: string;
            } | {
                /** @constant */
                kind: "move";
                evidence_id: string;
                group_id: string | null;
            } | {
                /** @constant */
                kind: "link";
                evidence_id: string;
                subject_id: string;
                linked: boolean;
            } | {
                /** @constant */
                kind: "derive";
                evidence_id: string;
                derivation_id?: string;
                recipe: {
                    /** @constant */
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
                } | {
                    /** @constant */
                    version: "documentary-rotated-region/1";
                    source_version_id: string;
                    source_digest: string;
                    page: number;
                    source_width: number;
                    source_height: number;
                    center_x_micro: string;
                    center_y_micro: string;
                    width_micro: string;
                    height_micro: string;
                    rotation_millidegrees: number;
                    output_width: number;
                    output_height: number;
                    aspect_ratio: {
                        width: number;
                        height: number;
                    } | null;
                };
            } | {
                /** @constant */
                kind: "select_attachment";
                subject_id: string;
                mode: "selected" | "declined" | "unset";
                version_id: string | null;
                destination: "lot_attachment" | "part_attachment";
            };
        };
        LiveCursor: {
            stream_id: string;
            /** Format: int64 */
            sequence: string;
        };
        LiveSubscribe: {
            /** @constant */
            type: "subscribe";
            /** @constant */
            protocol: "bench-intake-live/1";
            csrf_token: string;
            batch_id: string | null;
            cursors: {
                stream_id: string;
                /** Format: int64 */
                sequence: string;
            }[];
        };
        LiveFrame: {
            /** @constant */
            type: "ready";
            /** @constant */
            protocol: "bench-intake-live/1";
            cursors: {
                stream_id: string;
                /** Format: int64 */
                sequence: string;
            }[];
            truncated: boolean;
        } | {
            /** @constant */
            type: "changed";
            /** @constant */
            protocol: "bench-intake-live/1";
            batch_id: string;
            stream_id: string;
            /** Format: int64 */
            sequence: string;
            reset: boolean;
        } | {
            /** @constant */
            type: "heartbeat";
            /** @constant */
            protocol: "bench-intake-live/1";
        };
        Readiness: {
            /** @constant */
            status: "ready";
            /** @constant */
            api_version: "bench-intake-app/1";
            /** @constant */
            deployment: "restricted-local-development";
            /** @constant */
            identity: "deferred_T11";
            /** @constant */
            research: "unqualified";
            media: "configured" | "disabled";
            /** @constant */
            updates: "websocket-with-polling-fallback";
            /** @constant */
            apply: "separately-supervised-owned-fake-only";
        };
        NativeAgentResult: {
            proposal: {
                /** @constant */
                schema_version: "bench-intake-proposal/2";
                subject_id: string;
                summary: string;
                sources: ({
                    /** @constant */
                    kind: "note";
                    note_id: string;
                    text_sha256: string;
                } | {
                    /** @constant */
                    kind: "media_version";
                    evidence_id: string;
                    version_id: string;
                    sha256: string;
                })[];
            } | null;
            question: {
                kind: "quantity" | "clarification";
                subject_id: string;
                prompt: string;
                reason: string;
            } | null;
        };
        AgentSelection: {
            provider: "codex" | "claude";
            authentication: "api_key" | "subscription";
            model: string;
        };
        AgentSettings: {
            /** Format: int64 */
            revision: string;
            selection: {
                provider: "codex" | "claude";
                authentication: "api_key" | "subscription";
                model: string;
            } | null;
        };
        AgentSettingsUpdate: {
            /** Format: int64 */
            expected_revision: string;
            selection: {
                provider: "codex" | "claude";
                authentication: "api_key" | "subscription";
                model: string;
            };
        };
        AgentSessionList: {
            sessions: {
                attempt_id: string;
                batch_id: string;
                job_id: string;
                subject_id: string;
                stage: "reading" | "identifying" | "research" | "images" | "inventory";
                state: "queued" | "running" | "waiting_for_user" | "waiting_for_login" | "waiting_for_capacity" | "ready" | "failed" | "cancelled" | "superseded" | "interrupted";
                latest_on_job: boolean;
                selection: {
                    provider: "codex" | "claude";
                    authentication: "api_key" | "subscription";
                    model: string;
                };
                /** Format: int64 */
                settings_revision: string;
                queued_at: string;
                started_at: string | null;
                finished_at: string | null;
                native_session_id: string | null;
                actual_model: string | null;
                progress: "queued" | "starting" | "responding" | "settled";
                occupies_lane: boolean;
            }[];
            next_before: string | null;
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
export type CaptureListQuery = components['schemas']['CaptureListQuery']
export type InboxWorkflow = components['schemas']['InboxWorkflow']
export type InboxList = components['schemas']['InboxList']
export type CaptureRef = components['schemas']['CaptureRef']
export type CaptureQuantity = components['schemas']['CaptureQuantity']
export type CaptureLocation = components['schemas']['CaptureLocation']
export type CapturePartChoice = components['schemas']['CapturePartChoice']
export type CaptureDefaults = components['schemas']['CaptureDefaults']
export type CaptureContext = components['schemas']['CaptureContext']
export type CaptureLotContext = components['schemas']['CaptureLotContext']
export type CaptureContextRecord = components['schemas']['CaptureContextRecord']
export type CaptureEdit = components['schemas']['CaptureEdit']
export type CaptureObserve = components['schemas']['CaptureObserve']
export type CaptureObservation = components['schemas']['CaptureObservation']
export type CaptureSummary = components['schemas']['CaptureSummary']
export type CaptureList = components['schemas']['CaptureList']
export type CaptureSnapshot = components['schemas']['CaptureSnapshot']
export type ConnectionStatus = components['schemas']['ConnectionStatus']
export type HeaderWorkQuery = components['schemas']['HeaderWorkQuery']
export type HeaderWork = components['schemas']['HeaderWork']
export type InventoryModel = components['schemas']['InventoryModel']
export type InventoryPartSpec = components['schemas']['InventoryPartSpec']
export type InventoryMapping = components['schemas']['InventoryMapping']
export type SupportedEffectKind = components['schemas']['SupportedEffectKind']
export type SupportedEffectPreview = components['schemas']['SupportedEffectPreview']
export type PartOutput = components['schemas']['PartOutput']
export type SupportedEffectResult = components['schemas']['SupportedEffectResult']
export type ManualScope = components['schemas']['ManualScope']
export type ManualIssue = components['schemas']['ManualIssue']
export type ManualEffect = components['schemas']['ManualEffect']
export type ManualPreview = components['schemas']['ManualPreview']
export type ManualAttachment = components['schemas']['ManualAttachment']
export type ManualPartAttachment = components['schemas']['ManualPartAttachment']
export type ManualMediaEvidence = components['schemas']['ManualMediaEvidence']
export type ManualPreparationResult = components['schemas']['ManualPreparationResult']
export type ManualReviewResult = components['schemas']['ManualReviewResult']
export type ManualAccepted = components['schemas']['ManualAccepted']
export type ManualRunCommand = components['schemas']['ManualRunCommand']
export type ManualRecoveryCommand = components['schemas']['ManualRecoveryCommand']
export type ManualRun = components['schemas']['ManualRun']
export type ManualWorkspace = components['schemas']['ManualWorkspace']
export type ManualActivity = components['schemas']['ManualActivity']
export type ProcessingInputV4 = components['schemas']['ProcessingInputV4']
export type ProcessingCommandV4 = components['schemas']['ProcessingCommandV4']
export type ProcessingEnvelopeV4 = components['schemas']['ProcessingEnvelopeV4']
export type ProcessingInputV1 = components['schemas']['ProcessingInputV1']
export type ProcessingInputV2 = components['schemas']['ProcessingInputV2']
export type ProcessingInputV3 = components['schemas']['ProcessingInputV3']
export type ProcessingCommandV1 = components['schemas']['ProcessingCommandV1']
export type ProcessingCommandV2 = components['schemas']['ProcessingCommandV2']
export type ProcessingCommandV3 = components['schemas']['ProcessingCommandV3']
export type ProcessingProposalV1 = components['schemas']['ProcessingProposalV1']
export type ProcessingProposalV2 = components['schemas']['ProcessingProposalV2']
export type ProcessingProposalV3 = components['schemas']['ProcessingProposalV3']
export type ProcessingSource = components['schemas']['ProcessingSource']
export type ProcessingSourceV3 = components['schemas']['ProcessingSourceV3']
export type ProcessingEnvelopeV1 = components['schemas']['ProcessingEnvelopeV1']
export type ProcessingEnvelopeV2 = components['schemas']['ProcessingEnvelopeV2']
export type ProcessingEnvelopeV3 = components['schemas']['ProcessingEnvelopeV3']
export type ProcessingBlocker = components['schemas']['ProcessingBlocker']
export type ProcessingInput = components['schemas']['ProcessingInput']
export type ProcessingCommand = components['schemas']['ProcessingCommand']
export type ProcessingActivity = components['schemas']['ProcessingActivity']
export type ProcessingStage = components['schemas']['ProcessingStage']
export type ProcessingState = components['schemas']['ProcessingState']
export type ProcessingStart = components['schemas']['ProcessingStart']
export type ProcessingCancellation = components['schemas']['ProcessingCancellation']
export type ProcessingQuestionValue = components['schemas']['ProcessingQuestionValue']
export type ProcessingAnswer = components['schemas']['ProcessingAnswer']
export type ProcessingQuestionSpec = components['schemas']['ProcessingQuestionSpec']
export type ProcessingProposal = components['schemas']['ProcessingProposal']
export type ProcessingEnvelope = components['schemas']['ProcessingEnvelope']
export type ProcessingQuestion = components['schemas']['ProcessingQuestion']
export type ProcessingJob = components['schemas']['ProcessingJob']
export type ProcessingSnapshot = components['schemas']['ProcessingSnapshot']
export type ProcessingReceipt = components['schemas']['ProcessingReceipt']
export type ProcessingAnswerReceipt = components['schemas']['ProcessingAnswerReceipt']
export type OperatorIssueSeverity = components['schemas']['OperatorIssueSeverity']
export type OperatorIssueDisposition = components['schemas']['OperatorIssueDisposition']
export type OperatorIssue = components['schemas']['OperatorIssue']
export type OperatorReviewState = components['schemas']['OperatorReviewState']
export type OperatorLot = components['schemas']['OperatorLot']
export type OperatorRetiredLot = components['schemas']['OperatorRetiredLot']
export type OperatorInstruction = components['schemas']['OperatorInstruction']
export type OperatorReview = components['schemas']['OperatorReview']
export type IssueDisposition = components['schemas']['IssueDisposition']
export type BulkEdit = components['schemas']['BulkEdit']
export type OperatorImpact = components['schemas']['OperatorImpact']
export type BulkEditResult = components['schemas']['BulkEditResult']
export type Restructure = components['schemas']['Restructure']
export type RestructureResult = components['schemas']['RestructureResult']
export type InstructionEdit = components['schemas']['InstructionEdit']
export type ResearchReceiptSource = components['schemas']['ResearchReceiptSource']
export type ResearchEvidenceRead = components['schemas']['ResearchEvidenceRead']
export type ResearchSourceFetch = components['schemas']['ResearchSourceFetch']
export type ResearchReceiptRead = components['schemas']['ResearchReceiptRead']
export type ResearchInventoryLookup = components['schemas']['ResearchInventoryLookup']
export type ResearchReceipt = components['schemas']['ResearchReceipt']
export type ResearchReceiptDescriptor = components['schemas']['ResearchReceiptDescriptor']
export type ResearchEvidenceChunk = components['schemas']['ResearchEvidenceChunk']
export type ResearchSourceChunk = components['schemas']['ResearchSourceChunk']
export type ResearchInventoryObservation = components['schemas']['ResearchInventoryObservation']
export type ResearchInventoryResult = components['schemas']['ResearchInventoryResult']
export type MediaRecipe = components['schemas']['MediaRecipe']
export type MediaVersion = components['schemas']['MediaVersion']
export type MediaSnapshot = components['schemas']['MediaSnapshot']
export type MediaReceipt = components['schemas']['MediaReceipt']
export type MediaEdit = components['schemas']['MediaEdit']
export type LiveCursor = components['schemas']['LiveCursor']
export type LiveSubscribe = components['schemas']['LiveSubscribe']
export type LiveFrame = components['schemas']['LiveFrame']
export type Readiness = components['schemas']['Readiness']
export type NativeAgentResult = components['schemas']['NativeAgentResult']
export type AgentSelection = components['schemas']['AgentSelection']
export type AgentSettings = components['schemas']['AgentSettings']
export type AgentSettingsUpdate = components['schemas']['AgentSettingsUpdate']
export type AgentSessionList = components['schemas']['AgentSessionList']
