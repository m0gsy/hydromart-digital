// Message templating for broadcast campaigns (PRD Module 12 FR-088). Pure and side-effect
// free. Replaces the {{name}} and {{phone}} tokens (case-sensitive, replaced globally). An
// absent name yields an empty string for {{name}}.

export function renderTemplate(template: string, vars: { name?: string; phone: string }): string {
  return template.replace(/\{\{name\}\}/g, vars.name ?? '').replace(/\{\{phone\}\}/g, vars.phone);
}
