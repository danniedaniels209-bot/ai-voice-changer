"""
Motion Studio: a user-controlled motion-design/explainer-video editor.
No AI generation involved — the user builds everything by hand (shapes,
text, keyframes, connectors); this package only stores project data and
(from M2 onward) renders it to video.

models.py mirrors frontend/src/types/motion.ts field-for-field, same
convention as app.subtitle_engine — the editor canvas and the eventual
export renderer both consume this exact data, so what you build is what
gets exported.
"""
