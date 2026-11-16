import { useLayoutEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, Check, CornerDownRight } from 'lucide-react';
import { AltrasLogo } from '@/components/brand/AltrasLogo';
import { useAuthStore } from '@/stores/auth.store';
import { applyExperienceScope } from '@/features/researcher/researcher-experience';

function LearningLink({ to }: { to: string }) {
  return (
    <Link className="public-action" to={to}>
      Start Learning <ArrowRight aria-hidden="true" />
    </Link>
  );
}

function LearningFeatures() {
  return (
    <section
      id="explore"
      className="public-features public-page__content"
      aria-label="Explore ALTRAS"
    >
      <article className="public-feature">
        <div className="public-preview public-preview--learn" aria-hidden="true">
          <div className="public-preview__tabs">
            <strong>Lesson</strong>
            <span>Examples</span>
            <span>Key ideas</span>
          </div>
          <div>
            <BookOpen />
            <strong>
              From words
              <br />
              to expressions
            </strong>
            <span className="public-preview__line" />
            <span className="public-preview__line public-preview__line--short" />
          </div>
        </div>
        <div className="public-feature__copy">
          <span className="public-kicker">01 / Understand</span>
          <h2>Learn</h2>
          <p>Understand algebraic translation with structured explanations and worked examples.</p>
        </div>
      </article>
      <article className="public-feature">
        <div className="public-preview public-preview--practice" aria-hidden="true">
          <span>Translate the phrase:</span>
          <strong className="public-preview__phrase">“Three times a number”</strong>
          <div className="public-preview__answers">
            <span>
              <Check /> 3n
            </span>
            <span>n + 3</span>
          </div>
        </div>
        <div className="public-feature__copy">
          <span className="public-kicker">02 / Apply</span>
          <h2>Practice</h2>
          <p>
            Apply what you learn through interactive translation activities that build confidence.
          </p>
        </div>
      </article>
      <article className="public-feature">
        <div className="public-preview public-preview--progress" aria-hidden="true">
          <strong>Your learning journey</strong>
          <div className="public-preview__track">
            <span />
          </div>
          <div className="public-preview__progress">
            <div>
              <span>
                <Check /> Review your results
              </span>
              <span>
                <Check /> Build on each lesson
              </span>
            </div>
            <div className="public-preview__bars">
              <i />
              <i />
              <i />
            </div>
          </div>
        </div>
        <div className="public-feature__copy">
          <span className="public-kicker">03 / Reflect</span>
          <h2>Progress</h2>
          <p>
            Review your results and follow your learning progress as you prepare for assessments.
          </p>
        </div>
      </article>
    </section>
  );
}

export function LandingPage() {
  const authenticated = useAuthStore((state) => state.status === 'authenticated');
  // Existing /home guards select the authorized student/researcher/admin dashboard.
  const destination = authenticated ? '/home' : '/login';
  useLayoutEffect(() => applyExperienceScope('neutral'), []);

  return (
    <div className="public-page">
      <a className="public-skip" href="#main-content">
        Skip to content
      </a>
      <header className="public-nav public-page__content">
        <Link className="public-nav__brand" to="/" aria-label="ALTRAS home">
          <BookOpen aria-hidden="true" />
          <AltrasLogo linked={false} />
        </Link>
        <nav aria-label="Public navigation">
          <a href="#explore">Explore</a>
          <a href="#about">About</a>
          <Link to="/privacy">Privacy Policy</Link>
        </nav>
        <div className="public-nav__actions">
          <Link className="public-login" to={destination}>
            {authenticated ? 'Dashboard' : 'Log In'}
          </Link>
          <LearningLink to={destination} />
        </div>
      </header>
      <main id="main-content">
        <section className="public-hero public-page__content" aria-labelledby="landing-title">
          <div className="public-hero__copy">
            <p className="public-kicker">A little language. A little algebra.</p>
            <h1 id="landing-title">
              Math is a language.{' '}
              <br />
              <em>Learn to translate it.</em>
            </h1>
            <p>
              Discover how everyday words become algebraic expressions through guided lessons and
              interactive practice.
            </p>
            <LearningLink to={destination} />
          </div>
          <figure
            className="public-transformation"
            aria-label="Twice a number, plus five translates to 2x + 5"
          >
            <div className="public-note public-note--words">
              <span>In words</span>
              <p>
                Twice a number,
                <br />
                plus five.
              </p>
            </div>
            <CornerDownRight className="public-transformation__arrow" aria-hidden="true" />
            <div className="public-note public-note--math">
              <span>In algebra</span>
              <p>2x + 5</p>
            </div>
          </figure>
        </section>
        <section
          className="public-example public-page__content"
          aria-label="Algebraic translation example"
        >
          <div>
            <span className="public-kicker">Example</span>
            <p>Algebraic translation</p>
          </div>
          <blockquote>“Seven more than a number”</blockquote>
          <ArrowRight aria-hidden="true" />
          <p className="public-example__answer">x + 7</p>
        </section>
        <LearningFeatures />
        <section
          id="about"
          className="public-about public-page__content"
          aria-labelledby="about-title"
        >
          <BookOpen aria-hidden="true" />
          <h2 id="about-title">About ALTRAS</h2>
          <p>
            ALTRAS is an educational application for algebraic translation, developed in connection
            with a student research project at Benguet State University. It supports learning and
            practicing mathematical expressions; it is not an official university service or
            endorsement.
          </p>
        </section>
        <section className="public-closing public-page__content" aria-labelledby="closing-title">
          <h2 id="closing-title">Ready to start translating?</h2>
          <LearningLink to={destination} />
        </section>
      </main>
      <footer className="public-footer public-page__content">
        <Link className="public-nav__brand" to="/" aria-label="ALTRAS home">
          <AltrasLogo linked={false} />
        </Link>
        <p>An educational project on algebraic translation.</p>
        <Link to="/privacy">Privacy Policy</Link>
      </footer>
    </div>
  );
}

export function PrivacyPage() {
  useLayoutEffect(() => applyExperienceScope('neutral'), []);
  return (
    <div className="public-page public-page--placeholder">
      <header className="public-nav public-page__content">
        <Link className="public-nav__brand" to="/" aria-label="ALTRAS home">
          <AltrasLogo linked={false} />
        </Link>
      </header>
      <main className="public-placeholder public-page__content">
        <p className="public-kicker">ALTRAS</p>
        <h1>Privacy Policy — Coming Soon</h1>
        <Link className="public-action" to="/">
          Back to home
        </Link>
      </main>
    </div>
  );
}
