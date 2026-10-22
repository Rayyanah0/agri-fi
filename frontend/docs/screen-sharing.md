# Screen Sharing and Co-browsing

Collaborative rooms use the existing authenticated `/collaboration` Socket.IO namespace for signaling. Screen media is exchanged with WebRTC using `getDisplayMedia`; the server carries only offers, answers, and ICE candidates and never receives the media stream.

Sessions must verify the participant's JWT, require explicit screen-share consent, and request a fresh permission before remote control. Remote control is disabled by default and should be implemented with a narrowly scoped browser extension or platform capability; a normal web page cannot synthesize arbitrary user input.

Annotations are normalized coordinates and strokes broadcast to the room. Recording is opt-in for every participant, visibly indicated, encrypted at rest, and stopped when consent is withdrawn. Persist session duration, participant count, annotations, recording consent, and outcome using the existing collaboration session analytics. Scheduled sessions can use the existing deal notification/deadline flow, while moderators can admit, mute, or remove participants from the room.