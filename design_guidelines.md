# Premium AI Receptionist Dashboard - Design Guidelines

## Design Approach
**Reference-Based Approach**: Drawing inspiration from Linear (clean dashboard patterns), Notion (sidebar navigation), and Vercel (premium glassmorphism) combined with healthcare industry standards for trust and professionalism.

## Typography System
**Font Family**: Inter (Google Fonts)
- Display/Hero: 600 weight, 48-64px
- H1: 600 weight, 36-42px
- H2: 600 weight, 28-32px
- H3: 500 weight, 20-24px
- Body: 400 weight, 16px
- Small/Caption: 400 weight, 14px
- Button text: 500 weight, 16px

## Layout System
**Spacing Units**: Tailwind units of 2, 4, 6, 8, 12, 16, 24 (p-2, m-4, gap-8, etc.)
- Section padding: py-16 desktop, py-12 mobile
- Component gaps: gap-6 to gap-8
- Card padding: p-6 to p-8
- Button padding: px-6 py-3

**Grid Structure**:
- Dashboard: Fixed 280px sidebar + fluid main content
- Feature sections: 3-column grid (lg:grid-cols-3 md:grid-cols-2)
- Stats/metrics: 4-column grid (lg:grid-cols-4)
- Mobile: Single column stack

## Core Visual Elements

**Glassmorphism Implementation**:
- Sidebar: backdrop-blur-xl with 10% opacity background
- Cards/panels: backdrop-blur-md with 5% opacity background
- Modals/overlays: backdrop-blur-lg with 8% opacity
- All glass elements: 1px border with 15% white/mint opacity

**Gradients**:
- Primary gradient: Purple (#8B5CF6) to Blue (#3B82F6) at 135deg
- Accent gradient: Mint (#00C896) to teal at 90deg
- Background subtle gradient: Dark base with purple-to-blue sweep

**Shadows**:
- Premium cards: 0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.08)
- Elevated elements: 0 12px 48px rgba(0,0,0,0.18)
- Buttons: 0 4px 16px rgba(0,200,150,0.24) for mint, rgba(139,92,246,0.24) for purple

## Component Library

**Navigation Sidebar** (280px fixed):
- Logo at top with 40px height
- Navigation items with icon + label
- Active state: mint green left border (4px) + background tint
- Dark mode toggle at bottom
- Collapsible on mobile (overlay drawer)

**Dashboard Cards**:
- Glassmorphic background with premium shadow
- 24px rounded corners
- Metric cards: Large number (32px), label below (14px), trend indicator
- Chart cards: Header with title + timeframe selector, chart area with 16px padding

**Buttons**:
- Primary: Mint green (#00C896) background, white text, premium shadow
- Secondary: Glassmorphic with mint border, mint text
- Ghost: Transparent with mint text on hover
- Rounded: 8px corner radius
- Height: 44px for comfort
- Blur background when on images: backdrop-blur-md

**Form Inputs**:
- Glassmorphic background with subtle border
- 48px height for text inputs
- Mint green focus ring (2px)
- 8px rounded corners
- Label above: 14px, 500 weight

**Data Tables**:
- Alternating row tints (subtle)
- Hover state with 2% background lift
- Sticky header with glassmorphism
- Action buttons right-aligned
- 16px row padding

**Modal/Dialog**:
- Centered overlay with backdrop-blur-lg
- Max-width 600px
- 32px padding
- Close button top-right
- Premium shadow

## Dark Mode Specification
- Base background: #0A0A0B gradient to #1A1A2E
- Card backgrounds: #1E1E2E with 8% opacity
- Text primary: #FFFFFF (95% opacity)
- Text secondary: #A0A0B0
- Borders: #3A3A4E
- Mint green stays #00C896 (unchanged)
- Gradients slightly more vibrant in dark mode

## Page Structure

**Landing Page**:
1. **Hero Section** (80vh): Full-width image of modern dental clinic reception with AI interface overlay, headline "KI-Rezeption für Ihre Zahnklinik" (60px), subtitle, primary CTA with blur background, secondary CTA
2. **Features Grid** (3-column): Automatic appointment scheduling, patient communication, multi-language support - each with icon, title, description
3. **Dashboard Preview**: Full-width screenshot of dashboard in glassmorphic frame showing real UI
4. **Benefits Section** (2-column): Image left (happy dentist), benefits list right with checkmarks
5. **Integration Section**: Logo grid of dental software integrations (8-12 logos)
6. **Testimonials** (3-column cards): German dental clinic testimonials with photos, quotes, clinic names
7. **Pricing**: 3-tier pricing cards with gradient borders, feature lists
8. **CTA Section**: Bold gradient background, centered CTA, "14-Tage kostenlos testen"

**Dashboard**:
- Sidebar left with navigation
- Top bar: Search, notifications, profile
- Main: 4 metric cards in grid, 2 large chart cards below, recent activity table

## Images Section

**Hero Image**: Wide-angle, bright modern dental clinic reception area, clean minimalist design, natural lighting, subtle AI interface elements floating in frame. Professional photography quality, 1920x1080 minimum.

**Benefits Section Image**: Professional dentist using tablet/digital interface, warm smile, modern clinic setting, 800x1000 portrait orientation.

**Dashboard Screenshot**: Full interface preview showing sidebar, charts, data tables with realistic German text/data, glassmorphism effects clearly visible.

**Testimonial Photos**: Headshots of dental professionals, professional but approachable, 200x200px circular crops.

## Animations
- Page transitions: 200ms ease-out
- Hover states: 150ms ease
- Glass panels: Subtle shimmer on hover (opacity shift)
- Chart animations: 800ms staggered entry
- Minimal motion overall - premium feel through restraint