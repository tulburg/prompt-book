export const DEFAULT_MERMAID_FLOW = `flowchart LR
    REQ([Requirements])
    ARCH{Architecture Review}
    DESIGN[System Design]
    PROTO(Prototype)
    BE[[Backend Service]]
    FE[[Frontend App]]
    API[API Gateway]
    DB[(Database)]
    CACHE[(Cache Layer)]
    AUTH{Auth Service}
    QUEUE[Message Queue]
    WORKER(Worker Pool)
    TEST[Test Suite]
    LINT[Static Analysis]
    SEC{Security Scan}
    STAGE[Staging Deploy]
    PERF(Performance Test)
    REVIEW{Code Review}
    APPROVE([Approval Gate])
    PROD[Production Deploy]
    MONITOR[Monitoring]
    ALERT{Alert Manager}
    LOG[(Log Aggregator)]
    ROLLBACK(Rollback Plan)

    REQ --> ARCH
    ARCH --> DESIGN
    DESIGN --> PROTO
    PROTO --> BE
    PROTO --> FE
    BE --> API
    BE --> DB
    BE --> CACHE
    API --> AUTH
    BE --> QUEUE
    QUEUE --> WORKER
    WORKER --> DB
    FE --> API
    BE --> TEST
    FE --> TEST
    TEST --> LINT
    LINT --> SEC
    SEC --> REVIEW
    REVIEW --> APPROVE
    APPROVE --> STAGE
    STAGE --> PERF
    PERF --> PROD
    PROD --> MONITOR
    MONITOR --> ALERT
    MONITOR --> LOG
    ALERT --> ROLLBACK
    ROLLBACK --> STAGE

    %% @desc REQ: Gather and document functional and non-functional requirements from stakeholders. Includes user stories, acceptance criteria, and compliance constraints.
    %% @desc ARCH: Evaluate proposed architecture against scalability, reliability, and cost requirements. Produces an Architecture Decision Record (ADR).
    %% @desc DESIGN: Create detailed system design including data models, API contracts, sequence diagrams, and infrastructure topology.
    %% @desc PROTO: Build a minimal working prototype to validate core assumptions and gather early feedback from the team.
    %% @desc BE: Implement server-side business logic, data access layers, and service integrations using microservice patterns.
    %% @desc FE: Build the user-facing application with component-based architecture, state management, and responsive layouts.
    %% @desc API: Central gateway handling request routing, rate limiting, request transformation, and API versioning.
    %% @desc DB: Primary persistent storage with schema migrations, indexing strategy, and backup policies configured.
    %% @desc CACHE: In-memory caching layer (Redis/Memcached) for frequently accessed data to reduce database load and latency.
    %% @desc AUTH: Authentication and authorization service handling JWT tokens, OAuth2 flows, RBAC, and session management.
    %% @desc QUEUE: Asynchronous message broker for decoupling services, handling retries, and managing event-driven workflows.
    %% @desc WORKER: Background job processors that consume queue messages for tasks like email sending, report generation, and data sync.
    %% @desc TEST: Comprehensive test suite covering unit tests, integration tests, and end-to-end scenarios with coverage thresholds.
    %% @desc LINT: Static code analysis including linting, type checking, complexity analysis, and code style enforcement.
    %% @desc SEC: Automated security scanning for vulnerabilities, dependency audits, SAST/DAST, and compliance checks.
    %% @desc STAGE: Deploy to staging environment that mirrors production for final validation before release.
    %% @desc PERF: Load testing, stress testing, and performance benchmarking against defined SLOs and latency budgets.
    %% @desc REVIEW: Peer code review process ensuring code quality, knowledge sharing, and adherence to team conventions.
    %% @desc APPROVE: Manual approval gate requiring sign-off from tech lead and QA before production deployment.
    %% @desc PROD: Production deployment using blue-green or canary strategy with automated health checks and traffic shifting.
    %% @desc MONITOR: Real-time monitoring dashboard tracking metrics, traces, and health indicators across all services.
    %% @desc ALERT: Intelligent alerting system with severity levels, escalation policies, and on-call rotation integration.
    %% @desc LOG: Centralized log aggregation and search platform for debugging, auditing, and operational insights.
    %% @desc ROLLBACK: Automated rollback procedure triggered by failed health checks or critical alert thresholds.
`;
