import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, Check, CornerDownRight, X } from 'lucide-react';
import { AltrasLogo } from '@/components/brand/AltrasLogo';
import { ScreenshotStack } from './ScreenshotStack';
import { LoadingState } from '@/components/ui/LoadingState';
import { useAuthStore } from '@/stores/auth.store';
import { applyExperienceScope } from '@/features/researcher/researcher-experience';
import {
  getPublishedContent,
  getShowcaseImages,
  getPublishedShowcaseImageUrl,
  type LandingContent,
  type LandingShowcaseSlot,
  type LegalContent,
} from '@/features/public-content/public-content.service';

const landingFallback: LandingContent = {
  heroHeading: 'Math is a language.', heroEmphasis: 'Learn to translate it.',
  heroDescription: 'Discover how everyday words become algebraic expressions through guided lessons and interactive practice.',
  aboutTitle: 'About ALTRAS',
  aboutDescription: 'ALTRAS is an educational application for algebraic translation, developed in connection with a student research project at Benguet State University. It supports learning and practicing mathematical expressions; it is not an official university service or endorsement.',
  closingHeading: 'Ready to start translating?',
  learnHeading: 'Learn', learnDescription: 'Understand algebraic translation with structured explanations and worked examples.',
  practiceHeading: 'Practice', practiceDescription: 'Apply what you learn through interactive translation activities that build confidence.',
  progressHeading: 'Progress', progressDescription: 'Review your results and follow your learning progress as you prepare for assessments.',
  understandImagePath: null, understandImageAlt: '',
  applyImagePath: null, applyImageAlt: '',
  reflectImagePath: null, reflectImageAlt: '',
};

function LearningLink({ to }: { to: string }) {
  return <Link className="public-action" to={to}>Start Learning <ArrowRight aria-hidden="true" /></Link>;
}

const showcaseSections: Array<{
  slot: LandingShowcaseSlot;
  number: string;
  label: string;
  heading: keyof Pick<LandingContent, 'learnHeading' | 'practiceHeading' | 'progressHeading'>;
  description: keyof Pick<LandingContent, 'learnDescription' | 'practiceDescription' | 'progressDescription'>;
  path: keyof Pick<LandingContent, 'understandImagePath' | 'applyImagePath' | 'reflectImagePath'>;
  alt: keyof Pick<LandingContent, 'understandImageAlt' | 'applyImageAlt' | 'reflectImageAlt'>;
}> = [
  { slot: 'understand', number: '01', label: 'Understand', heading: 'learnHeading', description: 'learnDescription', path: 'understandImagePath', alt: 'understandImageAlt' },
  { slot: 'apply', number: '02', label: 'Apply', heading: 'practiceHeading', description: 'practiceDescription', path: 'applyImagePath', alt: 'applyImageAlt' },
  { slot: 'reflect', number: '03', label: 'Reflect', heading: 'progressHeading', description: 'progressDescription', path: 'reflectImagePath', alt: 'reflectImageAlt' },
];

function DecorativePreview({ slot }: { slot: LandingShowcaseSlot }) {
  if (slot === 'understand') return <div className="public-preview public-preview--learn" aria-hidden="true"><div className="public-preview__tabs"><strong>Lesson</strong><span>Examples</span><span>Key ideas</span></div><div><BookOpen /><strong>From words<br />to expressions</strong><span className="public-preview__line" /><span className="public-preview__line public-preview__line--short" /></div></div>;
  if (slot === 'apply') return <div className="public-preview public-preview--practice" aria-hidden="true"><span>Translate the phrase:</span><strong className="public-preview__phrase">“Three times a number”</strong><div className="public-preview__answers"><span><Check /> 3n</span><span>n + 3</span></div></div>;
  return <div className="public-preview public-preview--progress" aria-hidden="true"><strong>Your learning journey</strong><div className="public-preview__track"><span /></div><div className="public-preview__progress"><div><span><Check /> Review your results</span><span><Check /> Build on each lesson</span></div><div className="public-preview__bars"><i /><i /><i /></div></div></div>;
}

function LearningFeatures({ content, onOpenImage }: { content: LandingContent; onOpenImage: (source: string, alt: string) => void }) {
  return <section id="explore" className="public-features public-page__content" aria-label="Explore ALTRAS">
    {showcaseSections.map((section) => {
      const images = getShowcaseImages(content, section.slot).map((image) => ({
        source: getPublishedShowcaseImageUrl(image.path),
        alt: image.alt || section.label + ' ALTRAS gameplay screenshot',
      })).filter((image) => image.source);
      return <article key={section.slot} className="public-feature">
        {images.length ? <ScreenshotStack key={images.map((image) => image.source).join()} images={images} label={section.label} onOpen={onOpenImage} /> : <DecorativePreview slot={section.slot} />}
        <div className="public-feature__copy"><span className="public-kicker">{section.number} / {section.label}</span><h2>{content[section.heading]}</h2><p>{content[section.description]}</p></div>
      </article>;
    })}
  </section>;
}

function ScreenshotViewer({ source, alt, onClose }: { source: string; alt: string; onClose: () => void }) {
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);
  return <div className="public-image-viewer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="public-image-viewer__dialog" role="dialog" aria-modal="true" aria-label="Expanded gameplay screenshot">
      <button ref={closeButton} type="button" className="public-image-viewer__close" onClick={onClose} aria-label="Close screenshot viewer"><X aria-hidden="true" /></button>
      <img src={source} alt={alt} />
    </section>
  </div>;
}

export function LandingPage() {
  const authStatus = useAuthStore((state) => state.status);
  const authenticated = authStatus === 'authenticated';
  const authResolved = authStatus === 'guest' || authenticated;
  const [content, setContent] = useState<LandingContent>(landingFallback);
  const [viewer, setViewer] = useState<{ source: string; alt: string } | null>(null);
  const destination = authenticated ? '/home' : '/login';
  useLayoutEffect(() => applyExperienceScope('neutral'), []);
  useEffect(() => { void getPublishedContent<LandingContent>('landing').then((published) => { if (published) setContent(published); }).catch(() => undefined); }, []);
  return <div className="public-page">
    <a className="public-skip" href="#main-content">Skip to content</a>
    <header className="public-nav public-page__content"><Link className="public-nav__brand" to="/" aria-label="ALTRAS home"><BookOpen aria-hidden="true" /><AltrasLogo linked={false} /></Link><nav aria-label="Public navigation"><a href="#explore">Explore</a><a href="#about">About</a><Link to="/privacy-policy">Privacy Policy</Link><Link to="/terms-and-conditions">Terms</Link></nav><div className="public-nav__actions"><span className="public-login-slot">{authResolved ? <Link className="public-login" to={destination}>{authenticated ? 'Dashboard' : 'Log In'}</Link> : <span className="public-login" role="status" aria-label="Checking session" aria-busy="true">…</span>}</span><LearningLink to={destination} /></div></header>
    <main id="main-content"><section className="public-hero public-page__content" aria-labelledby="landing-title"><div className="public-hero__copy"><p className="public-kicker">A little language. A little algebra.</p><h1 id="landing-title">{content.heroHeading}<br /><em>{content.heroEmphasis}</em></h1><p>{content.heroDescription}</p><LearningLink to={destination} /></div><figure className="public-transformation" aria-label="Twice a number, plus five translates to 2x + 5"><div className="public-note public-note--words"><span>In words</span><p>Twice a number,<br />plus five.</p></div><CornerDownRight className="public-transformation__arrow" aria-hidden="true" /><div className="public-note public-note--math"><span>In algebra</span><p>2x + 5</p></div></figure></section>
      <section className="public-example public-page__content" aria-label="Algebraic translation example"><div><span className="public-kicker">Example</span><p>Algebraic translation</p></div><blockquote>“Seven more than a number”</blockquote><ArrowRight aria-hidden="true" /><p className="public-example__answer">x + 7</p></section>
      <LearningFeatures content={content} onOpenImage={(source, alt) => setViewer({ source, alt })} />
      <section id="about" className="public-about public-page__content" aria-labelledby="about-title"><BookOpen aria-hidden="true" /><h2 id="about-title">{content.aboutTitle}</h2><p>{content.aboutDescription}</p></section>
      <section className="public-closing public-page__content" aria-labelledby="closing-title"><h2 id="closing-title">{content.closingHeading}</h2><LearningLink to={destination} /></section>
    </main>
    <footer className="public-footer public-page__content"><Link className="public-nav__brand" to="/" aria-label="ALTRAS home"><AltrasLogo linked={false} /></Link><p>An educational project on algebraic translation.</p><Link to="/privacy-policy">Privacy Policy</Link><Link to="/terms-and-conditions">Terms</Link></footer>
    {viewer && <ScreenshotViewer source={viewer.source} alt={viewer.alt} onClose={() => setViewer(null)} />}
  </div>;
}

function LegalPage({ pageKey, fallbackTitle }: { pageKey: 'privacy-policy' | 'terms-and-conditions'; fallbackTitle: string }) {
  const [content, setContent] = useState<LegalContent | null>(null);
  const [loaded, setLoaded] = useState(false);
  useLayoutEffect(() => applyExperienceScope('neutral'), []);
  useEffect(() => {
    let active = true;
    void getPublishedContent<LegalContent>(pageKey)
      .then((published) => { if (active) setContent(published); })
      .catch(() => { if (active) setContent(null); })
      .finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, [pageKey]);
  return <div className="public-page public-page--legal"><header className="public-nav public-page__content"><Link className="public-nav__brand" to="/" aria-label="ALTRAS home"><AltrasLogo linked={false} /></Link><nav aria-label="Public navigation"><Link to="/privacy-policy">Privacy Policy</Link><Link to="/terms-and-conditions">Terms</Link></nav></header><main className="public-legal public-page__content">{!loaded ? <LoadingState className="public-legal__loading" variant="page" message="Loading page…" /> : <><p className="public-kicker">ALTRAS</p><h1>{content?.title ?? fallbackTitle}</h1>{content ? <><p className="public-legal__summary">{content.summary}</p><aside className="public-legal__child-notice" aria-label="Child-friendly notice"><h2>For younger learners</h2><p>{content.childFriendlyNotice}</p></aside>{content.sections.map((section, index) => <section key={`${section.heading}-${index}`}><h2>{section.heading}</h2><p>{section.body}</p></section>)}</> : <p>This page is being prepared for researcher approval. Please check back after the approved version is published.</p>}<Link className="public-action" to="/">Back to home</Link></>}</main></div>;
}

export function PrivacyPage() { return <LegalPage pageKey="privacy-policy" fallbackTitle="Privacy Policy" />; }
export function TermsPage() { return <LegalPage pageKey="terms-and-conditions" fallbackTitle="Terms and Conditions" />; }
