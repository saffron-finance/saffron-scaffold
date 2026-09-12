import { expect,it } from 'vitest'
import { tokenAmount } from './model'

it('truncates token labels without rounding across thresholds or hiding dust',()=>{
  // Decimal-string cases reproduce the long formatUnits values in the modal;
  // converting them to Number first would incorrectly round 499.999… to 500.
  const labels:[number|string,string][]=[
    ['499.999999999999999972','499.99'],['0.024999999999999999','0.0249'],
    ['25000.0000000000679998','25,000'],['1755.274','1,755.2'],
    ['0.99999','0.9999'],['1.2399','1.23'],['999.999','999.99'],['1000.999','1,000.9'],
    ['0.000000000000000001','<0.0001'],[1e-30,'<0.0001'],['0.0000','0'],[0.02,'0.02'],
    ['9007199254740993.99','9,007,199,254,740,993.9'],['12.3000','12.3'],[NaN,'—'],
  ]
  for(const [value,label] of labels)expect(tokenAmount(value)).toBe(label)
})
