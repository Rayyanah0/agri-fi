# Emotional AI Chatbot Documentation

## Overview

The Emotional AI Chatbot provides 24/7 empathetic customer support and guidance to users across the AgriFi platform. It understands user emotions, detects sentiment from text input, and tailors responses to provide personalized assistance.

## Architecture

### Backend Components

#### 1. Emotion Detection (`emotion-detector.service.ts`)
- Analyzes text input to detect emotional state
- Detects emotions: happy, sad, angry, anxious, confused, frustrated, neutral
- Provides confidence scores and intensity metrics
- Keyword-based analysis for speed and privacy (no cloud calls)

**Key Features:**
- Keyword matching for multiple emotions simultaneously
- Intensity calculation (0-1 scale)
- Flag detection (all caps, high punctuation, urgency markers)

#### 2. Empathy Engine (`empathy-engine.service.ts`)
- Generates emotionally-aware responses
- Tailors responses based on detected emotion and user context
- Suggests actionable next steps

**Response Templates by Emotion:**
- **Happy**: Celebratory acknowledgments, positive momentum builders
- **Sad**: Empathetic support, encouragement to continue
- **Angry**: Solution-focused, problem-solving oriented
- **Anxious**: Reassuring, confidence-building
- **Confused**: Clarifying, step-by-step guidance
- **Frustrated**: Supportive, action-oriented

#### 3. Contextual Understanding (`chatbot-context.service.ts`)
- Retrieves user role and recent deal/investment context
- Identifies new vs. experienced users
- Suggests role-appropriate topics
- Detects deal-specific questions

**Context Enrichment:**
- User role (trader, farmer, investor, logistics)
- Recent deals and transactions
- Deal status and milestones
- New user onboarding detection

#### 4. Chatbot Service (`chatbot.service.ts`)
- Orchestrates emotion detection, empathy engine, and context
- Stores conversations with metadata
- Escalation logic for complex issues
- Analytics and satisfaction tracking

### Frontend Components

#### ChatbotWidget
- Main chat interface with message history
- Real-time emotion display
- Suggested actions display
- Escalation to human agent
- Message typing and sending

#### ChatbotButton
- Floating action button to open/close chatbot
- Pulsing animation to draw attention
- Toast notifications for new messages

#### ChatbotMessage
- Individual message rendering
- Emotion emoji display with confidence
- Timestamp formatting

#### ChatbotActions
- Suggested action buttons
- One-click action triggering
- Context-aware action suggestions

## Emotion Detection

### How It Works

The emotion detector analyzes text through:

1. **Keyword Matching**: Searches for emotion-specific keywords
   - Each emotion has positive and negative keywords
   - Negative keywords weighted more heavily (2x)
   - Intensity based on keyword frequency

2. **Intensity Markers**:
   - ALL CAPS text
   - Multiple punctuation (!!!, ???)
   - Request keywords (please, help)

3. **Confidence Calculation**:
   - Highest score emotion selected as primary
   - Confidence = emotion_score / total_score
   - Higher scores = higher confidence

### Emotion Types

| Emotion | Indicator | Typical Keywords | Response Tone |
|---------|-----------|------------------|---------------|
| Happy | Positive feedback | great, wonderful, love, perfect | Celebratory |
| Sad | Disappointment | sad, disappointed, down, lost | Empathetic |
| Angry | Strong frustration | angry, furious, hate, upset | Calming |
| Anxious | Uncertainty | worried, nervous, scared, stressed | Reassuring |
| Confused | Unclear | confused, don't understand, unclear | Clarifying |
| Frustrated | Ongoing issues | frustrated, annoyed, fed up | Supportive |
| Neutral | Standard inquiry | question, help, information | Informative |

## Contextual Understanding

### User Context Enrichment

```typescript
{
  userId: string;
  userRole: 'trader' | 'farmer' | 'investor' | 'logistics';
  recentDeals: TradeDeal[];
  recentInvestments: Investment[];
  isNewUser: boolean;
  preferredLanguage: string;
}
```

### Context-Aware Suggestions

The chatbot tailors suggestions based on:
- **User Role**: Role-specific features and workflows
- **New User Status**: Onboarding-focused guidance
- **Recent Deals**: Deal-specific support
- **User History**: Past interactions and satisfaction

### Suggested Topics

**For All Users:**
- How to create a deal
- Track your shipment
- View investments
- Platform fees

**For Traders:**
- Create new trade deal
- Manage milestones
- Escrow information

**For Farmers:**
- Understand pricing
- Track harvest deals
- Settlement process

**For Investors:**
- View returns
- Investment portfolio
- Risk assessment

**For New Users:**
- Getting started guide
- Account setup
- KYC requirements
- Platform tour

## Privacy & Data Handling

### Local Processing
- All emotion detection runs locally (no cloud calls)
- No conversation data sent to external AI services
- Keywords stored in memory only

### Data Storage
- Conversations stored in PostgreSQL database
- Encrypted at rest
- User can delete conversation history
- Automatic cleanup of old conversations (90 days)

### Privacy Compliance
- No voice data stored
- No user data shared with third parties
- GDPR-compliant data handling
- User consent for conversation analysis

## Escalation Logic

The chatbot automatically escalates to human agents when:

1. **High-Intensity Negative Emotions**
   - Anger or frustration with intensity > 70%

2. **Escalation Keywords**
   - "human", "manager", "supervisor", "urgent"
   - "legal", "complaint", "emergency"

3. **User Request**
   - Manual escalation button

### Escalation Flow

```
Detect High-Emotion Issue
         ↓
Offer Escalation Option
         ↓
User Clicks Escalate
         ↓
Connect to Human Agent
         ↓
Transfer Conversation Context
```

## Analytics & Learning

### Tracked Metrics

- **Emotion Distribution**: Percentage of each emotion detected
- **Escalation Rate**: % of conversations escalated
- **Average Satisfaction**: User satisfaction ratings (1-5)
- **Resolution Rate**: % resolved without escalation
- **Response Time**: Average response latency

### Analytics Endpoint

```bash
GET /api/v1/chatbot/analytics?startDate=2024-01-01&endDate=2024-01-31
```

**Response:**
```json
{
  "totalConversations": 1250,
  "emotionDistribution": {
    "happy": 320,
    "neutral": 450,
    "confused": 280,
    "anxious": 150,
    "sad": 40,
    "angry": 10
  },
  "escalationRate": 0.08,
  "averageSatisfaction": 4.2,
  "resolutionRate": 0.92
}
```

### Satisfaction Recording

Users can rate satisfaction after each interaction (1-5 stars).

```bash
POST /api/v1/chatbot/{conversationId}/satisfaction
{
  "rating": 5
}
```

## Multi-Language Support

### Implementation

Uses existing i18n infrastructure from Next.js:

- Emotion detection language-agnostic (based on keywords)
- Response templates translated per language
- User's preferred language stored in profile
- Auto-detect from browser language

### Supported Languages

- English (en)
- Spanish (es)
- French (fr)
- Portuguese (pt)
- Mandarin (zh)

### Translation Strategy

1. Core emotion keywords translated per language
2. Empathy templates duplicated per language
3. Context suggestions localized

## Integration Examples

### Using the Chatbot in Layout

```tsx
import { ChatbotWidget } from '@/components/chatbot/ChatbotWidget';
import { ChatbotButton } from '@/components/chatbot/ChatbotButton';
import { useChatbot } from '@/hooks/useChatbot';

export default function Layout() {
  const { isOpen, open, close } = useChatbot();
  const userId = useUser()?.id;

  return (
    <>
      <ChatbotButton onClick={open} isOpen={isOpen} />
      <ChatbotWidget userId={userId} isOpen={isOpen} onClose={close} />
    </>
  );
}
```

### Sending Message to Backend

```typescript
const response = await fetch('/api/v1/chatbot/message', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({
    message: 'How do I create a deal?',
    language: 'en',
  }),
});

const data = await response.json();
// {
//   conversationId: "uuid",
//   response: "...",
//   emotion: "confused",
//   emotionConfidence: 0.85,
//   suggestedActions: [...],
//   tone: "clarifying"
// }
```

### Conversation History

```typescript
const history = await fetch('/api/v1/chatbot/history?limit=10', {
  headers: { Authorization: `Bearer ${token}` },
});

const conversations = await history.json();
```

## Performance Considerations

- Emotion detection: ~5-10ms per message
- Local keyword matching (no network latency)
- Response generation: ~20-30ms
- Total API round-trip: ~100-200ms

## Future Enhancements

1. **Voice Support**: Analyze emotion from speech input
2. **ML-based Emotion Detection**: Train custom model on conversation data
3. **Sentiment Analysis**: Beyond emotion, track sentiment polarity
4. **Multilingual Support**: Expand to 20+ languages
5. **Learning Loop**: Improve responses based on satisfaction feedback
6. **Context Memory**: Maintain longer conversation state
7. **Proactive Assistance**: Suggest help based on user activity

## Troubleshooting

### Chatbot Not Responding

1. Check backend service status
2. Verify JWT token is valid
3. Check browser console for errors
4. Ensure chatbot module is imported in app.module.ts

### Incorrect Emotion Detection

- Current implementation uses keyword matching
- False positives may occur with sarcasm or context
- Future versions will use ML-based detection

### Escalation Not Working

- Verify human agent queue is available
- Check escalation permissions
- Review escalation logs in database

## Database Schema

```sql
CREATE TABLE chatbot_conversations (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  message TEXT NOT NULL,
  response TEXT NOT NULL,
  detected_emotion VARCHAR(50),
  emotion_confidence FLOAT,
  user_satisfaction INT,
  escalated BOOLEAN DEFAULT FALSE,
  escalated_to UUID,
  language VARCHAR(10) DEFAULT 'en',
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  deleted_at TIMESTAMP
);

CREATE INDEX idx_chatbot_user_id ON chatbot_conversations(user_id);
CREATE INDEX idx_chatbot_created_at ON chatbot_conversations(created_at);
```

## Success Metrics

Target metrics for success:

- ✅ **70%+ Resolution Rate**: Without escalation
- ✅ **4.5/5 Average Satisfaction**: User ratings
- ✅ **<5% False Positive Escalations**: Unnecessary escalations
- ✅ **<200ms Response Time**: API latency
- ✅ **99.9% Availability**: Uptime
- ✅ **Multi-language Coverage**: 5+ languages at launch
