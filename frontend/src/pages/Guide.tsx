import { type ReactNode } from "react";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border border-border rounded-lg bg-surface/50 p-5">
      <h3 className="font-semibold mb-2">{title}</h3>
      <div className="text-sm text-text-muted space-y-2 [&_b]:text-text [&_b]:font-medium">
        {children}
      </div>
    </section>
  );
}

export function Guide() {
  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h2 className="text-xl font-semibold mb-1">How to use this app</h2>
        <p className="text-text-muted text-sm">
          Everything the studio can do, in the order you'd use it.
        </p>
      </div>

      <Section title="1 · Convert a video (the basics)">
        <p>
          On <b>New Conversion</b>: drop your video, pick a mode, pick a voice, press{" "}
          <b>Start conversion</b>. Background music and effects are kept automatically.
        </p>
        <p>
          <b>The four modes:</b> <b>Narrate my script</b> — you type the words, an AI voice
          speaks them over the video. <b>Re-voice the speech</b> — replaces the existing
          speech with an AI narrator at the exact same timing (the "AI ad" sound).{" "}
          <b>Expressive (OpenVoice)</b> — keeps your delivery, changes the voice's timbre.{" "}
          <b>Voice model (RVC)</b> — uses a trained model from the Models page.
        </p>
        <p>
          <b>Original quality vs Smaller file</b> (under the dropzone): Original keeps your
          video bit-exact. Smaller file shrinks huge CapCut-style exports several-fold with
          no visible quality loss.
        </p>
      </Section>

      <Section title="2 · Subtitles">
        <p>
          Use the <b>Subtitles</b> buttons on New Conversion. <b>Add subtitles</b> exports a{" "}
          <b>.srt</b> file next to your video — upload it to YouTube as a caption track. Pick
          a language in the dropdown to ALSO get a translated copy (Spanish, Hindi, etc.) —
          the audio stays unchanged. Want captions burned into the picture? Turn on{" "}
          <b>Burn captions</b> in Settings (re-encodes the video).
        </p>
      </Section>

      <Section title="3 · Voices and engines">
        <p>
          <b>Fast (cloud)</b> — Microsoft neural voices, quick, needs internet.{" "}
          <b>Human-like (local)</b> — Chatterbox, clones the chosen voice with an{" "}
          <b>Expressiveness</b> dial (0 calm → 1 dramatic); slower without a GPU.
        </p>
        <p>
          <b>Your own voice:</b> enable Custom voices in Settings, upload a clean 10–30s
          sample, then pick it in the voice list (uses the local engine).
        </p>
        <p>
          <b>Dub into another language:</b> in Re-voice mode, pick a language and dub voice —
          the speech is transcribed, translated, and re-narrated with the original timing.
          Needs a GPU session.
        </p>
      </Section>

      <Section title="4 · Fix lines after converting (Segment editor)">
        <p>
          Open a finished job from <b>Jobs</b>. Every narration line is listed with its
          timestamp: click the time to jump the video there, edit the text, press <b>▶</b> to
          preview just that line, or <b>↻</b> for a different take. Then{" "}
          <b>Apply changes &amp; re-export</b> — only the lines you changed are re-generated,
          so it's fast.
        </p>
      </Section>

      <Section title="5 · AI Chat (your assistant)">
        <p>
          The AI can run the whole app for you. Attach a video with <b>📎</b>, tell it what
          you want ("re-voice this in Spanish, dramatic"), answer its questions, and it starts
          the conversion itself. Ask "how's it going?" for progress. It can also read
          transcripts, rewrite narration lines, and list voices.
        </p>
        <p>
          <b>Create tool:</b> ask it to build a tool that doesn't exist yet ("make a tool
          that counts words per minute") — it writes a small Python program, tests it in a
          sandbox, and keeps it only if the tests pass. Use the <b>Create tool</b> button or
          just ask in plain words.
        </p>
        <p>
          <b>Models:</b> Qwen2.5 3B is fastest; Qwen3 8B is smartest (bigger download);
          Hermes 3 is a middle ground. Switch anytime in the top-right dropdown.
        </p>
      </Section>

      <Section title="6 · Script Studio">
        <p>
          Write or generate narration scripts: give it a topic → outline → full script, then
          polish with actions (rewrite, simplify, more engaging…) and generate YouTube
          extras — titles, description, chapters, keywords, thumbnail ideas. Render the
          narration right there or send the script into a conversion.
        </p>
      </Section>

      <Section title="7 · Cloud GPU (Colab)">
        <p>
          Free GPU for the heavy AI features (chat, script generation, dubbing, best
          transcription). Open the notebook from <b>deploy/DEPLOY.md</b>, run the cell, and
          open the printed link. When you update the app: stop the cell,{" "}
          <b>git pull</b>, re-run — you get a fresh link each time.
        </p>
        <p>
          <b>Heads-up on cloud sessions:</b> uploads are auto-deleted after 90 minutes of
          inactivity and finished exports after 2 hours — download your results promptly.
          Big files upload fine (they're sent in chunks).
        </p>
      </Section>

      <Section title="8 · Where things end up">
        <p>
          Finished videos land in the <b>exports/</b> folder (with subtitles next to them).
          Settings lets you change quality presets (Low → Lossless), vertical 9:16 export for
          Shorts, music ducking, loudness normalization, and more.
        </p>
      </Section>
    </div>
  );
}
