# Design Guidelines: AI Receptionist for Dental Clinics

## Design Approach
**Reference-Based**: Modern B2B SaaS inspired by Linear, Stripe, and Vercel. Professional, clean aesthetic that builds trust with dental clinic owners while showcasing technical sophistication.

## Core Design Principles
- **Trust & Credibility**: Medical/dental context demands professional, polished design
- **Clarity Over Complexity**: Information hierarchy prioritizes understanding the product value
- **Subtle Sophistication**: Modern without being trendy; clean without being sterile

## Color Palette

**Light Mode**:
- Primary: 210 100% 45% (Professional blue - medical trust)
- Primary Hover: 210 100% 35%
- Background: 0 0% 100%
- Surface: 210 20% 98% (Subtle blue tint)
- Text Primary: 215 25% 15%
- Text Secondary: 215 15% 45%
- Border: 215 20% 88%
- Success: 145 65% 45% (Status indicators)
- Warning: 35 90% 55%

**Dark Mode**:
- Primary: 210 100% 55%
- Primary Hover: 210 100% 65%
- Background: 215 25% 8%
- Surface: 215 20% 12%
- Text Primary: 210 20% 98%
- Text Secondary: 210 15% 70%
- Border: 215 20% 20%

## Typography
**Fonts**: Inter (via Google Fonts) for all text
- H1 Hero: text-5xl md:text-7xl font-bold tracking-tight
- H2 Sections: text-3xl md:text-4xl font-semibold
- H3 Cards: text-xl font-semibold
- Body: text-base md:text-lg leading-relaxed
- Small: text-sm text-secondary

## Layout System
**Spacing**: Tailwind units of 4, 6, 8, 12, 16, 20, 24 (p-4, gap-6, py-12, etc.)
- Section Padding: py-16 md:py-24
- Container: max-w-7xl mx-auto px-6
- Card Spacing: gap-8
- Content Max Width: max-w-4xl for text-heavy sections

## Component Library

### Hero Section
- Full viewport height (min-h-screen) with gradient background
- Gradient: from-blue-50 to-white (light) / from-slate-900 to-slate-800 (dark)
- Center-aligned content with max-w-4xl
- Dual CTAs: Primary (filled) + Secondary (outline with backdrop-blur-sm)
- Subtext: max-w-2xl, text-lg, text-secondary

### Feature Cards (How It Works)
- Grid: grid-cols-1 md:grid-cols-3 gap-8
- Card Design: p-8, rounded-2xl, border with subtle shadow
- Icon: Large circular background (w-16 h-16) with colored accent
- Number badges: Small rounded-full with gradient
- Card hover: subtle scale and shadow transition

### Dashboard Preview
- Full-width section with dark surface background
- Table: Full-featured with alternating row colors
- Header row: sticky, bold, uppercase text-sm
- Status badges: Rounded pills with color-coded backgrounds
- Responsive: Horizontal scroll on mobile

### Modal (Call Simulation)
- Backdrop: backdrop-blur-md with dark overlay
- Modal: max-w-2xl, rounded-3xl, shadow-2xl
- Transcript: Chat-bubble style messages
- Patient messages: Left-aligned, blue background
- AI messages: Right-aligned, gray background
- Close button: Absolute top-right with hover effect

### Connect Your Clinic
- Grid: grid-cols-1 md:grid-cols-3 gap-6
- Disabled buttons: opacity-50, cursor-not-allowed
- "Coming Soon" badges: Absolute positioned, small rounded pills
- Icon + Text layout in each button

### Footer
- Simple centered text, py-8
- Single line with separator dots between credits
- Subtle text-secondary color

## Navigation
- Sticky header: backdrop-blur-lg, border-b
- Logo text (no image): font-semibold text-xl
- CTA button in header (optional): "Get Started"

## Interactive Elements
- Buttons: rounded-lg, px-6 py-3, font-medium
- Primary: bg-primary text-white with hover:bg-primary-hover
- Outline: border-2 with backdrop-blur for image overlays
- Transitions: transition-all duration-200
- No complex hover animations - rely on subtle scale/opacity

## Images
**Hero Section**: Yes - Professional dental office image or AI/tech abstract
- Position: Background with overlay gradient
- Treatment: Subtle blur or opacity to ensure text readability
- Fallback: Gradient if no suitable image

**Feature Icons**: Use Heroicons (outline style) via CDN
- Size: w-8 h-8 within colored circles
- Colors: Match primary palette with variations

## Accessibility
- Consistent dark mode across all components including form inputs
- ARIA labels for modal and interactive elements
- Focus states: ring-2 ring-primary ring-offset-2
- Keyboard navigation support for modal

## Special Considerations
- Modal opens smoothly with fade + scale animation
- Table should be fully responsive with proper mobile handling
- Disabled buttons clearly communicate "coming soon" state
- Single-page scroll with smooth anchor links
- Professional, medical-grade polish throughout