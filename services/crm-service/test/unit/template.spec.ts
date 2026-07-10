import { renderTemplate } from '../../src/domain/template';

describe('renderTemplate', () => {
  it('substitutes both {{name}} and {{phone}}', () => {
    expect(renderTemplate('Hi {{name}} at {{phone}}', { name: 'Andi', phone: '+62811' })).toBe(
      'Hi Andi at +62811',
    );
  });

  it('replaces {{name}} with an empty string when name is absent', () => {
    expect(renderTemplate('Hi {{name}}!', { phone: '+62811' })).toBe('Hi !');
  });

  it('replaces every occurrence globally', () => {
    expect(renderTemplate('{{phone}}/{{phone}}', { phone: '9' })).toBe('9/9');
  });

  it('passes a template with no tokens through unchanged', () => {
    expect(renderTemplate('No tokens here', { name: 'X', phone: '1' })).toBe('No tokens here');
  });

  it('is case-sensitive — {{Name}} is left untouched', () => {
    expect(renderTemplate('{{Name}}', { name: 'Andi', phone: '1' })).toBe('{{Name}}');
  });
});
