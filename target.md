AgentWatch: ML-Powered AI Agent Activity Monitor | Python, scikit-learn, WebSockets [GitHub]
• Built a macOS system-level AI agent monitor that intercepts real-time stdout from CLI AI tools (Gemini CLI,
Claude Code) via a custom PTY wrapper, enabling programmatic session tracking across concurrent agent
processes.
• Trained a custom TF-IDF + LinearSVC text classifier achieving ∼99% accuracy across 7 event types on labeled
CLI output data, replacing fragile regex-based detection with a robust, maintainable ML pipeline.
• Designed a WebSocket notification and reply-injection architecture with a companion Chrome extension for
multi-layer browser-side AI generation detection, supporting live concurrent multi-session monitoring.
Achievements & Leadership