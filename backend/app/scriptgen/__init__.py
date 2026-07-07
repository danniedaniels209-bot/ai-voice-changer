"""
AI Script Studio — idea to finished script.

Modules (deliberately decoupled from narration: the narration engine
consumes plain text and never knows where a script came from):

    llm        — local LLM runtime (Qwen2.5-3B-Instruct), cloud-GPU gated
    generator  — Topic Analyzer / Outline Generator / Script Generator /
                 Rewrite Engine prompt logic on top of the LLM
"""
