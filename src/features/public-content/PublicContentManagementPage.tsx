import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { AdminFeedbackToast } from '@/features/admin/AdminFeedbackToast';
import { AdminContentLoading } from '@/features/admin/AdminContentLoading';
import { AdminPageHeader } from '@/features/admin/AdminPageHeader';
import {
  getDraftShowcaseImageUrl,
  isLegalContent,
  listContentPages,
  pageKeys,
  publishContent,
  saveContentDraft,
  uploadLandingShowcaseImage,
  type ContentPage,
  type LandingContent,
  type LegalContent,
  type PublicContent,
  type PublicContentPageKey,
} from './public-content.service';

const labels: Record<PublicContentPageKey, string> = {
  landing: 'Landing page',
  'privacy-policy': 'Privacy Policy',
  'terms-and-conditions': 'Terms and Conditions',
};

function TextField({
  label,
  description,
  value,
  onChange,
  multiline = false,
}: {
  label: string;
  description: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
}) {
  const id = `public-content-${label.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}`;
  return (
    <div className="public-content-field">
      <label htmlFor={id}>{label}</label>
      <p>{description}</p>
      {multiline ? (
        <textarea id={id} value={value} onChange={(event) => onChange(event.target.value)} rows={4} />
      ) : (
        <input id={id} value={value} onChange={(event) => onChange(event.target.value)} />
      )}
    </div>
  );
}

function ContentPreview({ content }: { content: PublicContent }) {
  if (!isLegalContent(content)) {
    const landing = content as LandingContent;
    return (
      <aside className="public-content-preview public-content-preview--landing" aria-label="Landing page preview">
        <p className="public-content-preview__label">Live-style preview</p>
        <section className="public-content-preview__hero">
          <p className="public-kicker">A little language. A little algebra.</p>
          <h2>{landing.heroHeading}</h2>
          <h3>{landing.heroEmphasis}</h3>
          <p>{landing.heroDescription}</p>
        </section>
        <section className="public-content-preview__features" aria-label="Landing feature previews">
          {[
            [landing.learnHeading, landing.learnDescription],
            [landing.practiceHeading, landing.practiceDescription],
            [landing.progressHeading, landing.progressDescription],
          ].map(([heading, description]) => (
            <article key={heading}><h3>{heading}</h3><p>{description}</p></article>
          ))}
        </section>
        <section className="public-content-preview__about"><h3>{landing.aboutTitle}</h3><p>{landing.aboutDescription}</p></section>
        <strong className="public-content-preview__closing">{landing.closingHeading}</strong>
      </aside>
    );
  }
  const legal = content as LegalContent;
  return (
    <aside className="public-content-preview public-content-preview--legal" aria-label="Legal page preview">
      <p className="public-content-preview__label">Live-style preview</p>
      <p className="public-kicker">ALTRAS</p>
      <h2>{legal.title}</h2>
      <p className="public-content-preview__summary">{legal.summary}</p>
      <section className="public-content-preview__notice"><h3>For younger learners</h3><p>{legal.childFriendlyNotice}</p></section>
      {legal.sections.map((section, index) => <section key={`${section.heading}-${index}`} className="public-content-preview__legal-section"><h3>{section.heading}</h3><p>{section.body}</p></section>)}
    </aside>
  );
}

const landingShowcaseFields = [
  { slot: 'understand', label: 'Understand', context: 'Lesson or chapter teaching screen', heading: 'learnHeading', description: 'learnDescription', path: 'understandImagePath', alt: 'understandImageAlt' },
  { slot: 'apply', label: 'Apply', context: 'Choose the Correct Translation activity', heading: 'practiceHeading', description: 'practiceDescription', path: 'applyImagePath', alt: 'applyImageAlt' },
  { slot: 'reflect', label: 'Reflect', context: 'Assessment result or learning progress screen', heading: 'progressHeading', description: 'progressDescription', path: 'reflectImagePath', alt: 'reflectImageAlt' },
] as const;

function ShowcaseEditor({
  title,
  context,
  path,
  alt,
  onChange,
  onUpload,
}: {
  title: string;
  context: string;
  path: string | null;
  alt: string;
  onChange: (patch: { imagePath?: string | null; imageAlt?: string }) => void;
  onUpload: (file: File) => Promise<void>;
}) {
  const [preview, setPreview] = useState('');
  const [uploading, setUploading] = useState(false);
  useEffect(() => {
    let active = true;
    if (!path) return () => { active = false; };
    void getDraftShowcaseImageUrl(path).then((url) => { if (active) setPreview(url); }).catch(() => { if (active) setPreview(''); });
    return () => { active = false; };
  }, [path]);
  return <fieldset className="public-content-showcase"><legend>{title}</legend><p>{context}. Upload an actual gameplay screenshot; it remains private until this landing draft is published.</p>
    <div className="public-content-field"><label htmlFor={`landing-${title.toLowerCase()}-image`}>{title} screenshot</label><p>WebP, PNG, or JPEG, up to 5 MB. Between 320×180 and 3840×3840 pixels.</p><input id={`landing-${title.toLowerCase()}-image`} type="file" accept="image/webp,image/png,image/jpeg" disabled={uploading} onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; setUploading(true); void onUpload(file).catch(() => undefined).finally(() => { setUploading(false); event.currentTarget.value = ''; }); }} />{path && preview && <img className="public-content-showcase__image" src={preview} alt={alt || `${title} screenshot preview`} />}</div>
    <TextField label={`${title} image alternative text`} description="Describe what is visible for screen readers." value={alt} onChange={(imageAlt) => onChange({ imageAlt })} />
    {path && <Button type="button" variant="quiet" onClick={() => onChange({ imagePath: null })}>Remove screenshot</Button>}
  </fieldset>;
}

function LandingEditor({ draft, update, onUpload }: { draft: LandingContent; update: (patch: Partial<LandingContent>) => void; onUpload: (slot: 'understand' | 'apply' | 'reflect', file: File) => Promise<void> }) {
  return <>
    <section className="public-content-editor-section" aria-labelledby="landing-hero-fields"><header><h2 id="landing-hero-fields">Hero</h2><p>Shown at the top of the public home page.</p></header><div className="public-content-editor-section__fields">
      <TextField label="Hero heading" description="The first large line visitors see." value={draft.heroHeading} onChange={(heroHeading) => update({ heroHeading })} />
      <TextField label="Hero emphasis" description="The highlighted second line under the hero heading." value={draft.heroEmphasis} onChange={(heroEmphasis) => update({ heroEmphasis })} />
      <TextField label="Hero description" description="Short introduction below the hero heading." multiline value={draft.heroDescription} onChange={(heroDescription) => update({ heroDescription })} />
    </div></section>
    <section className="public-content-editor-section" aria-labelledby="landing-feature-fields"><header><h2 id="landing-feature-fields">Gameplay showcase</h2><p>These sections use real student-interface screenshots when an approved image is published. Existing illustrations remain until then.</p></header><div className="public-content-editor-section__fields">
      {landingShowcaseFields.map((section) => <fieldset key={section.slot}><legend>{section.label}</legend><TextField label={`${section.label} title`} description="Title next to this screenshot." value={draft[section.heading]} onChange={(value) => update({ [section.heading]: value })} /><TextField label={`${section.label} description`} description="Supporting text next to this screenshot." multiline value={draft[section.description]} onChange={(value) => update({ [section.description]: value })} /><ShowcaseEditor title={section.label} context={section.context} path={draft[section.path] ?? null} alt={draft[section.alt] ?? ''} onUpload={(file) => onUpload(section.slot, file)} onChange={({ imagePath, imageAlt }) => update({ ...(imagePath !== undefined ? { [section.path]: imagePath } : {}), ...(imageAlt !== undefined ? { [section.alt]: imageAlt } : {}) })} /></fieldset>)}
    </div></section>
    <section className="public-content-editor-section" aria-labelledby="landing-about-fields"><header><h2 id="landing-about-fields">About and closing</h2><p>Shown near the bottom of the landing page.</p></header><div className="public-content-editor-section__fields">
      <TextField label="About title" description="Heading for the ALTRAS project description." value={draft.aboutTitle} onChange={(aboutTitle) => update({ aboutTitle })} />
      <TextField label="About description" description="Public description of the project and research context." multiline value={draft.aboutDescription} onChange={(aboutDescription) => update({ aboutDescription })} />
      <TextField label="Closing heading" description="Heading above the final Start Learning action." value={draft.closingHeading} onChange={(closingHeading) => update({ closingHeading })} />
    </div></section>
  </>;
}

function LegalEditor({ draft, update }: { draft: LegalContent; update: (patch: Partial<LegalContent>) => void }) {
  return <>
    <section className="public-content-editor-section" aria-labelledby="legal-summary-fields"><header><h2 id="legal-summary-fields">Page summary</h2><p>Shown at the top of the approved public legal page.</p></header><div className="public-content-editor-section__fields">
      <TextField label="Page title" description="The public page heading." value={draft.title} onChange={(title) => update({ title })} />
      <TextField label="Version label" description="Internal-facing publication/version note included in the approved page content." value={draft.versionLabel} onChange={(versionLabel) => update({ versionLabel })} />
      <TextField label="Summary" description="Short explanation before the detailed sections." multiline value={draft.summary} onChange={(summary) => update({ summary })} />
      <TextField label="Child-friendly notice" description="A plain-language notice displayed alongside the full policy or terms." multiline value={draft.childFriendlyNotice} onChange={(childFriendlyNotice) => update({ childFriendlyNotice })} />
    </div></section>
    <section className="public-content-editor-section" aria-labelledby="legal-section-fields"><header><h2 id="legal-section-fields">Detailed sections</h2><p>These sections appear below the child-friendly notice.</p></header><div className="public-content-editor-section__fields">
      {draft.sections.map((section, index) => <fieldset key={index}><legend>Section {index + 1}</legend><TextField label={`Section ${index + 1} heading`} description="Short section heading." value={section.heading} onChange={(heading) => update({ sections: draft.sections.map((item, itemIndex) => itemIndex === index ? { ...item, heading } : item) })} /><TextField label={`Section ${index + 1} body`} description="Full text shown below this heading." multiline value={section.body} onChange={(body) => update({ sections: draft.sections.map((item, itemIndex) => itemIndex === index ? { ...item, body } : item) })} /></fieldset>)}
    </div></section>
  </>;
}

export function PublicContentManagementPage() {
  const [pages, setPages] = useState<ContentPage[] | null>(null);
  const [selectedKey, setSelectedKey] = useState<PublicContentPageKey>('landing');
  const [draft, setDraft] = useState<PublicContent | null>(null);
  const [message, setMessage] = useState('');
  const [messageKind, setMessageKind] = useState<'success' | 'error'>('success');
  const [saving, setSaving] = useState(false);
  useEffect(() => { void listContentPages().then(setPages).catch((error: unknown) => { setMessageKind('error'); setMessage(error instanceof Error ? error.message : 'Unable to load public content.'); }); }, []);
  const selected = useMemo(() => pages?.find((page) => page.pageKey === selectedKey) ?? null, [pages, selectedKey]);
  const activeDraft = draft ?? selected?.draftContent ?? null;
  if (!pages || !selected || !activeDraft) {
    if (!message) return <AdminContentLoading message="Loading content…" />;
    return (
      <section className="public-content-management__loading">
        <AdminPageHeader
          title="Content Management"
          description={message}
        />
      </section>
    );
  }
  const update = (patch: Partial<PublicContent>) => setDraft({ ...activeDraft, ...patch } as PublicContent);
  const uploadShowcase = async (slot: 'understand' | 'apply' | 'reflect', file: File) => {
    setMessage(''); setMessageKind('success');
    try {
      const imagePath = await uploadLandingShowcaseImage(slot, file);
      const key = `${slot}ImagePath` as 'understandImagePath' | 'applyImagePath' | 'reflectImagePath';
      setDraft((current) => ({ ...((current ?? activeDraft) as LandingContent), [key]: imagePath }));
      setMessage('Screenshot uploaded. Save the draft to keep this change.');
    } catch (error) {
      setMessageKind('error');
      setMessage(error instanceof Error ? error.message : 'Unable to upload screenshot.');
      throw error;
    }
  };
  const save = async (publish = false) => {
    setSaving(true); setMessage(''); setMessageKind('success');
    try {
      const saved = await saveContentDraft(selected.pageKey, activeDraft, selected.revision);
      const next = publish ? await publishContent(saved.pageKey, saved.revision) : saved;
      setPages((current) => current?.map((page) => page.pageKey === next.pageKey ? next : page) ?? null);
      setDraft(next.draftContent);
      setMessage(publish ? 'Published content is now available publicly.' : 'Draft saved.');
    } catch (error) { setMessageKind('error'); setMessage(error instanceof Error ? error.message : 'Unable to save content.'); } finally { setSaving(false); }
  };
  const published = Boolean(selected.publishedAt);
  return <section className="public-content-management" aria-labelledby="content-management-title">
    <AdminPageHeader id="content-management-title" title="Content Management" description="Manage public pages. Edit a draft, review the preview, then publish only approved content. Legal drafts are never public." />
    <section className="public-content-management__workspace">
    <div className="public-content-management__tabs" role="tablist" aria-label="Public page content">{pageKeys.map((pageKey) => <button key={pageKey} type="button" role="tab" aria-selected={pageKey === selectedKey} onClick={() => { setSelectedKey(pageKey); setDraft(null); setMessage(''); }}>{labels[pageKey]}</button>)}</div>
    <div className="admin-publication"><span className={`admin-publication__state admin-publication__state--${published ? 'published' : 'unpublished'}`}>{published ? 'Published' : 'Unpublished draft'}</span><p>{published ? `Published ${new Date(selected.publishedAt!).toLocaleString()}` : 'Only researchers and administrators can see this draft.'} · Last edited {selected.updatedAt ? new Date(selected.updatedAt).toLocaleString() : 'not available'}</p></div>
    <div className="public-content-management__grid"><div className="public-content-management__editor">{selectedKey === 'landing' ? <LandingEditor draft={activeDraft as LandingContent} update={update} onUpload={uploadShowcase} /> : <LegalEditor draft={activeDraft as LegalContent} update={update} />}<div className="public-content-management__actions"><Button type="button" variant="secondary" disabled={saving} onClick={() => void save()}>Save draft</Button><Button type="button" disabled={saving} onClick={() => void save(true)}>Publish approved content</Button></div></div><ContentPreview content={activeDraft} /></div>
    </section>
    {message && <AdminFeedbackToast kind={messageKind} message={message} onDismiss={() => setMessage('')} />}
  </section>;
}
