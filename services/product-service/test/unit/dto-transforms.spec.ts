import { plainToInstance } from 'class-transformer';

import { CreateCategoryDto } from '../../src/modules/dto/category.dto';
import { BrowseProductsQueryDto, CreateProductDto } from '../../src/modules/dto/product.dto';

describe('DTO @Type(() => Number) coercion', () => {
  it('coerces page and limit query strings to numbers', () => {
    const dto = plainToInstance(BrowseProductsQueryDto, { page: '3', limit: '25' });
    expect(dto.page).toBe(3);
    expect(dto.limit).toBe(25);
  });

  it('coerces basePrice string to a number', () => {
    const dto = plainToInstance(CreateProductDto, { basePrice: '20000' });
    expect(dto.basePrice).toBe(20000);
  });

  it('coerces category sortOrder string to a number', () => {
    const dto = plainToInstance(CreateCategoryDto, { sortOrder: '5' });
    expect(dto.sortOrder).toBe(5);
  });
});
